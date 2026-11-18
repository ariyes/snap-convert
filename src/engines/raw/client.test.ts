// The RAW client's start and failure handling, with a stand-in Worker: a worker that can't start is
// "unavailable" (inside a worker the engine then runs right there), never "out of memory"; only a
// worker dying during a develop is out of memory.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeRawWorker,
  rawDevelop,
  rawEngineMode,
  rawInfo,
  RawWorkerError,
  resetRawEngineMode,
} from './client';
import { RawDecodeError, toDecodeError } from './index';
import type { RawFileInfo, RawRequest } from './protocol';
import { rawStrings } from './strings';

const INFO = { width: 6000, height: 4000 } as RawFileInfo;
const HERE = { width: 1, height: 1 } as RawFileInfo;

// The engine as it runs in-process (the real one needs WebAssembly).
const engine = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock('./engine', () => ({
  inspect: engine.inspect,
  preview: vi.fn(),
  develop: vi.fn(),
  RawEngineError: class extends Error {},
}));

/** What a stand-in worker does: never start, start and answer, or start and die on a request. */
type Behaviour = 'fail-start' | 'answer' | 'die-on-request';

class FakeWorker {
  static plan: Behaviour[] = [];
  static started: Behaviour[] = [];
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  private readonly behaviour: Behaviour;
  terminated = false;

  constructor() {
    this.behaviour = FakeWorker.plan.shift() ?? 'answer';
    FakeWorker.started.push(this.behaviour);
    setTimeout(() => {
      // A browser that can't fetch the script: an error event without a message.
      if (this.behaviour === 'fail-start') this.emit('error', { preventDefault: () => undefined });
      else this.emit('message', { data: { type: 'ready' } });
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
  engine.inspect.mockReset().mockResolvedValue(HERE);
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  closeRawWorker();
  resetRawEngineMode();
  vi.unstubAllGlobals();
});

describe('starting the RAW worker', () => {
  it('uses a RAW worker when one starts', async () => {
    await expect(rawInfo(file)).resolves.toEqual(INFO);
    expect(FakeWorker.started).toEqual(['answer']);
    expect(rawEngineMode()).toBe('worker');
    expect(engine.inspect).not.toHaveBeenCalled();
  });

  it('inside a worker that can’t start one, the engine runs right there (from then on)', async () => {
    vi.stubGlobal('document', undefined); // the image worker has no document
    FakeWorker.plan = ['fail-start'];
    await expect(rawInfo(file)).resolves.toEqual(HERE);
    expect(rawEngineMode()).toBe('in-process');
    await expect(rawInfo(file)).resolves.toEqual(HERE);
    expect(FakeWorker.started).toHaveLength(1); // not tried again
    expect(engine.inspect).toHaveBeenCalledTimes(2);
  });

  it('on the page, it fails as unavailable — not out of memory — and the message says so', async () => {
    FakeWorker.plan = ['fail-start'];
    const error = await rawDevelop(file, develop).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RawWorkerError);
    expect((error as RawWorkerError).failure.kind).toBe('unavailable');
    expect(engine.inspect).not.toHaveBeenCalled(); // never on the main thread
    const shown = toDecodeError(error);
    expect(shown).toBeInstanceOf(RawDecodeError);
    expect(shown).toMatchObject({ code: 'unavailable', message: rawStrings.unavailable });
    expect((shown as Error).message).not.toBe(rawStrings.tooLarge);
  });
});

describe('a worker that dies after starting', () => {
  it('during a develop: out of memory ("Too large for this device")', async () => {
    vi.stubGlobal('document', undefined);
    FakeWorker.plan = ['die-on-request'];
    const error = await rawDevelop(file, develop).catch((e: unknown) => e);
    expect((error as RawWorkerError).failure.kind).toBe('out-of-memory');
    expect(toDecodeError(error)).toMatchObject({ code: 'too-large', message: rawStrings.tooLarge });
    // It did start: no fallback to running here.
    expect(rawEngineMode()).toBe('worker');
  });

  it('while only reading details: unavailable, not out of memory', async () => {
    FakeWorker.plan = ['die-on-request'];
    const error = await rawInfo(file).catch((e: unknown) => e);
    expect((error as RawWorkerError).failure.kind).toBe('unavailable');
  });
});
