// The RAW client's start and failure handling, with a stand-in Worker: a worker that can't start is
// "unavailable" (and is tried once more from a blob module), never "out of memory"; only a worker
// dying during a develop is out of memory.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeRawWorker,
  rawDevelop,
  rawInfo,
  rawWorkerStart,
  RawWorkerError,
  resetRawWorkerStart,
} from './client';
import { RawDecodeError, toDecodeError } from './index';
import type { RawFileInfo, RawRequest } from './protocol';
import { rawStrings } from './strings';

/** What a stand-in worker does: never start, start and answer, or start and die on a request. */
type Behaviour = 'fail-start' | 'answer' | 'die-on-request';

const INFO = { width: 6000, height: 4000 } as RawFileInfo;

class FakeWorker {
  static plan: Behaviour[] = [];
  static started: Array<{ url: string; behaviour: Behaviour }> = [];
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  private readonly behaviour: Behaviour;
  terminated = false;

  constructor(url: string | URL) {
    this.behaviour = FakeWorker.plan.shift() ?? 'answer';
    FakeWorker.started.push({ url: String(url), behaviour: this.behaviour });
    setTimeout(() => {
      if (this.behaviour === 'fail-start') {
        this.emit('error', { message: '', preventDefault: () => undefined });
      } else {
        this.emit('message', { data: { type: 'ready' } });
      }
    }, 0);
  }

  addEventListener(type: string, fn: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }

  postMessage(request: RawRequest) {
    setTimeout(() => {
      if (this.terminated) return;
      if (this.behaviour === 'die-on-request') {
        this.emit('error', { message: 'Out of memory', preventDefault: () => undefined });
      } else {
        this.emit('message', { data: { id: request.id, ok: true, result: INFO } });
      }
    }, 0);
  }

  terminate() {
    this.terminated = true;
  }

  private emit(type: string, event: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

const file = new Blob([new Uint8Array(16)]);
const develop = {
  whiteBalance: 'as-shot',
  exposure: 0,
  highlights: 'clip',
  halfSize: false,
} as const;

beforeEach(() => {
  FakeWorker.plan = [];
  FakeWorker.started = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  closeRawWorker();
  resetRawWorkerStart();
  vi.unstubAllGlobals();
});

describe('starting the RAW worker', () => {
  it('starts from its URL when it can', async () => {
    await expect(rawInfo(file)).resolves.toEqual(INFO);
    expect(FakeWorker.started).toHaveLength(1);
    expect(FakeWorker.started[0]?.url).toMatch(/raw\.worker/);
    expect(rawWorkerStart()).toBe('direct');
  });

  it('a worker whose script can’t be fetched is started from a blob module instead', async () => {
    FakeWorker.plan = ['fail-start', 'answer'];
    await expect(rawInfo(file)).resolves.toEqual(INFO);
    expect(FakeWorker.started.map((s) => s.url.slice(0, 5))).toEqual([
      expect.not.stringMatching(/^blob:/),
      'blob:',
    ]);
    // Later workers here start that way straight away.
    expect(rawWorkerStart()).toBe('blob');
  });

  it('if neither way starts, requests fail as unavailable, not out of memory', async () => {
    FakeWorker.plan = ['fail-start', 'fail-start'];
    const error = await rawDevelop(file, develop).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RawWorkerError);
    expect((error as RawWorkerError).failure.kind).toBe('unavailable');
    expect(FakeWorker.started).toHaveLength(2);
    // Shown in plain words, and distinguishable from a file that's too big.
    const shown = toDecodeError(error);
    expect(shown).toBeInstanceOf(RawDecodeError);
    expect(shown).toMatchObject({ code: 'unavailable', message: rawStrings.unavailable });
    expect((shown as Error).message).not.toBe(rawStrings.tooLarge);
  });
});

describe('a worker that dies after starting', () => {
  it('during a develop: out of memory ("Too large for this device")', async () => {
    FakeWorker.plan = ['die-on-request'];
    const error = await rawDevelop(file, develop).catch((e: unknown) => e);
    expect((error as RawWorkerError).failure.kind).toBe('out-of-memory');
    expect(toDecodeError(error)).toMatchObject({ code: 'too-large', message: rawStrings.tooLarge });
    // Not retried from a blob: it did start.
    expect(FakeWorker.started).toHaveLength(1);
  });

  it('while only reading details: unavailable, not out of memory', async () => {
    FakeWorker.plan = ['die-on-request'];
    const error = await rawInfo(file).catch((e: unknown) => e);
    expect((error as RawWorkerError).failure.kind).toBe('unavailable');
  });
});
