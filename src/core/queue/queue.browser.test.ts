// The queue with real module workers (the fake worker in test-worker.ts) in real Chromium.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobStatus } from '@/core/contracts';
import { IDLE_TIMEOUT_MS, WorkerPool } from './pool';
import { WorkerUnavailableError, type WorkerRegistry } from './registry';
import { createQueueStore, type QueueStore } from './store';
import { queueStrings } from './strings';

interface TrackedWorker {
  worker: Worker;
  terminated: boolean;
}

interface WorkResult {
  workerId: string;
  value: unknown;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function setup(opts: { size?: number; idleMs?: number; registry?: Partial<WorkerRegistry> } = {}) {
  const created: TrackedWorker[] = [];
  const make = () => {
    const worker = new Worker(new URL('./test-worker.ts', import.meta.url), { type: 'module' });
    const tracked: TrackedWorker = { worker, terminated: false };
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      tracked.terminated = true;
      terminate();
    };
    created.push(tracked);
    return worker;
  };
  const pool = new WorkerPool({
    registry: { image: make, pdf: make, ...opts.registry },
    size: opts.size ?? 4,
    idleMs: opts.idleMs ?? IDLE_TIMEOUT_MS,
  });
  const queue = createQueueStore({ pool });
  cleanups.push(() => {
    queue.getState().clear();
    pool.dispose();
  });
  const alive = () => created.filter((w) => !w.terminated).length;
  return { pool, queue, created, alive };
}

const job = (queue: QueueStore, id: string): Job => {
  const found = queue.getState().jobs.find((j) => j.id === id);
  if (!found) throw new Error(`no job ${id}`);
  return found;
};

const statuses = (queue: QueueStore, ids: string[]): JobStatus[] =>
  ids.map((id) => job(queue, id).status);

const isIdle = (queue: QueueStore) =>
  queue.getState().jobs.every((j) => j.status !== 'waiting' && j.status !== 'working');

async function waitUntil(check: () => boolean, timeout = 10_000): Promise<void> {
  await vi.waitFor(
    () => {
      if (!check()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('job queue', () => {
  it('runs 50 jobs with random durations, at most pool-size in parallel, first-in first-out', async () => {
    const { queue, pool, alive } = setup({ size: 4 });
    let maxWorking = 0;
    let maxAlive = 0;
    const startOrder: string[] = [];
    const seen = new Set<string>();
    const unsubscribe = queue.subscribe((s) => {
      maxWorking = Math.max(maxWorking, s.stats.working);
      maxAlive = Math.max(maxAlive, alive(), pool.stats().live + pool.stats().starting);
      for (const j of s.jobs) {
        if (j.status !== 'waiting' && !seen.has(j.id)) {
          seen.add(j.id);
          startOrder.push(j.id);
        }
      }
    });
    cleanups.push(unsubscribe);

    const items = Array.from({ length: 50 }, (_, i) => ({
      label: `file-${i}.jpg`,
      input: { ms: 10 + Math.round(Math.random() * 90), steps: 3, value: i },
    }));
    const ids = queue.getState().add('image', 'work', items);
    expect(ids).toHaveLength(50);
    expect(queue.getState().stats).toMatchObject({ total: 50, waiting: 50, working: 0 });

    queue.getState().start();
    await waitUntil(() => queue.getState().stats.done === 50, 20_000);

    expect(maxWorking).toBe(4);
    expect(maxAlive).toBeLessThanOrEqual(4);
    expect(startOrder).toEqual(ids);
    const values = ids.map((id) => (job(queue, id).result as WorkResult).value);
    expect(values).toEqual(items.map((_, i) => i));
    for (const id of ids) {
      const j = job(queue, id);
      expect(j.progress).toBe(1);
      expect(j.startedAt).toBeTypeOf('number');
      expect(j.endedAt).toBeGreaterThanOrEqual(j.startedAt ?? Infinity);
    }
    expect(queue.getState().stats).toEqual({
      total: 50,
      waiting: 0,
      working: 0,
      done: 50,
      failed: 0,
      etaSeconds: null,
    });
    // Warm workers were reused, not one per job.
    expect(pool.stats().created).toBe(4);
  });

  it('writes progress to the store at least every 250 ms while working', async () => {
    const { queue } = setup({ size: 1 });
    const [id = ''] = queue
      .getState()
      .add('image', 'work', [{ label: 'slow.jpg', input: { ms: 1500, steps: 60 } }]);
    const times: number[] = [];
    let last = -1;
    const unsubscribe = queue.subscribe((s) => {
      const j = s.jobs.find((x) => x.id === id);
      if (j?.status === 'working' && j.progress !== last) {
        last = j.progress;
        times.push(performance.now());
      }
    });
    cleanups.push(unsubscribe);
    queue.getState().start();
    await waitUntil(() => job(queue, id).status === 'done');

    expect(times.length).toBeGreaterThan(5);
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(250);
  });

  it('does nothing until start(), then picks up jobs added later', async () => {
    const { queue } = setup({ size: 2 });
    const [a = ''] = queue.getState().add('image', 'work', [{ label: 'a', input: { ms: 20 } }]);
    await sleep(100);
    expect(job(queue, a).status).toBe('waiting');
    queue.getState().start();
    await waitUntil(() => job(queue, a).status === 'done');
    const [b = ''] = queue.getState().add('pdf', 'work', [{ label: 'b', input: { ms: 20 } }]);
    await waitUntil(() => job(queue, b).status === 'done');
  });

  it('cancel one: a waiting job is cancelled, a working job stops and its worker is replaced', async () => {
    const { queue, created } = setup({ size: 2 });
    const ids = queue.getState().add(
      'image',
      'work',
      ['a', 'b', 'c', 'd'].map((label) => ({ label, input: { ms: 600, steps: 30 } })),
    );
    const [a = '', b = '', c = '', d = ''] = ids;
    queue.getState().start();
    await waitUntil(() => statuses(queue, [a, b]).every((s) => s === 'working'));
    await waitUntil(() => job(queue, a).progress > 0);

    queue.getState().cancel(d); // waiting
    expect(job(queue, d).status).toBe('cancelled');

    const workersBefore = created.length;
    queue.getState().cancel(a); // working
    expect(job(queue, a).status).toBe('cancelled');
    expect(job(queue, a).endedAt).toBeTypeOf('number');
    expect(created.filter((w) => w.terminated)).toHaveLength(1);
    // The freed slot goes to the next waiting job straight away, on a new worker.
    expect(job(queue, c).status).toBe('working');
    await waitUntil(() => created.length === workersBefore + 1);
    expect(job(queue, b).status).toBe('working');

    await waitUntil(() => isIdle(queue));
    expect(statuses(queue, ids)).toEqual(['cancelled', 'done', 'done', 'cancelled']);
    // Cancelling a finished job does nothing.
    queue.getState().cancel(b);
    expect(job(queue, b).status).toBe('done');
  });

  it('cancel all: waiting jobs are cleared and working ones stop', async () => {
    const { queue, alive, pool } = setup({ size: 2 });
    const ids = queue.getState().add(
      'image',
      'work',
      Array.from({ length: 6 }, (_, i) => ({ label: `f${i}`, input: { ms: 2000 } })),
    );
    queue.getState().start();
    await waitUntil(() => queue.getState().stats.working === 2 && alive() === 2);

    queue.getState().cancel();
    expect(statuses(queue, ids).every((s) => s === 'cancelled')).toBe(true);
    expect(queue.getState().stats).toMatchObject({ waiting: 0, working: 0, etaSeconds: null });
    expect(alive()).toBe(0);
    expect(pool.stats().live).toBe(0);

    // Stopped: new jobs wait for start().
    const [late = ''] = queue
      .getState()
      .add('image', 'work', [{ label: 'late', input: { ms: 10 } }]);
    await sleep(100);
    expect(job(queue, late).status).toBe('waiting');
  });

  it('retry: a failed or cancelled job goes back to waiting and the queue resumes', async () => {
    const { queue } = setup({ size: 2 });
    const [bad = ''] = queue
      .getState()
      .add('image', 'throw', [{ label: 'bad', input: { message: 'Broken file' } }]);
    const [slow = ''] = queue
      .getState()
      .add('image', 'work', [{ label: 'slow', input: { ms: 800, value: 'slow' } }]);
    queue.getState().start();
    await waitUntil(() => job(queue, bad).status === 'failed');
    queue.getState().cancel(); // stops the queue; `slow` is cancelled
    expect(job(queue, slow).status).toBe('cancelled');

    queue.getState().retry(slow);
    expect(['waiting', 'working']).toContain(job(queue, slow).status);
    expect(job(queue, slow).progress).toBe(0);
    expect(job(queue, slow).endedAt).toBeUndefined();
    await waitUntil(() => job(queue, slow).status === 'done', 10_000);
    expect((job(queue, slow).result as WorkResult).value).toBe('slow');

    queue.getState().retry(bad);
    expect(job(queue, bad).error).toBeUndefined();
    await waitUntil(() => job(queue, bad).status === 'failed');
    expect(job(queue, bad).error).toBe('Broken file');

    // Retrying a done job does nothing.
    queue.getState().retry(slow);
    expect(job(queue, slow).status).toBe('done');
  });

  it('retry puts the job at the back of the line', async () => {
    const { queue } = setup({ size: 1 });
    const ids = queue.getState().add(
      'image',
      'work',
      ['a', 'b', 'c'].map((label) => ({ label, input: { ms: 150 } })),
    );
    const [a = '', b = '', c = ''] = ids;
    queue.getState().cancel(a);
    const order: string[] = [];
    cleanups.push(
      queue.subscribe((s) => {
        for (const j of s.jobs)
          if (j.status === 'working' && !order.includes(j.id)) order.push(j.id);
      }),
    );
    queue.getState().start();
    queue.getState().retry(a);
    await waitUntil(() => isIdle(queue));
    expect(order).toEqual([b, c, a]);
  });

  it('remove and clear drop jobs and their results; removing a working job stops it', async () => {
    const { queue, created } = setup({ size: 1 });
    const [done = '', working = '', next = ''] = queue.getState().add('image', 'work', [
      { label: 'done', input: { ms: 10, value: 'x' } },
      { label: 'working', input: { ms: 5000 } },
      { label: 'next', input: { ms: 10 } },
    ]);
    queue.getState().start();
    await waitUntil(() => job(queue, working).status === 'working');
    expect(job(queue, done).result).toBeDefined();

    queue.getState().remove(done);
    expect(queue.getState().jobs.map((j) => j.id)).toEqual([working, next]);
    expect(queue.getState().stats.total).toBe(2);

    queue.getState().remove(working);
    expect(created.filter((w) => w.terminated)).toHaveLength(1);
    expect(queue.getState().jobs.map((j) => j.id)).toEqual([next]);
    await waitUntil(() => job(queue, next).status === 'done');

    queue.getState().add('image', 'work', [{ label: 'long', input: { ms: 5000 } }]);
    await waitUntil(() => queue.getState().stats.working === 1);
    queue.getState().clear();
    expect(queue.getState().jobs).toEqual([]);
    expect(queue.getState().stats).toEqual({
      total: 0,
      waiting: 0,
      working: 0,
      done: 0,
      failed: 0,
      etaSeconds: null,
    });
    expect(created.filter((w) => !w.terminated)).toHaveLength(0);
    // Unknown ids are ignored.
    queue.getState().remove('nope');
    queue.getState().cancel('nope');
    queue.getState().retry('nope');
  });

  it('a worker that throws or crashes fails only its job; the rest finish', async () => {
    const { queue, created } = setup({ size: 3 });
    const s = queue.getState();
    const add: typeof s.add = (kind, op, items) => s.add(kind, op, items);
    const ok1 = add('image', 'work', [{ label: 'ok1', input: { ms: 30 } }]);
    const [thrown = ''] = add('image', 'throw', [
      { label: 'thrown', input: { message: 'This file is not an image' } },
    ]);
    const ok2 = add('image', 'work', [{ label: 'ok2', input: { ms: 30 } }]);
    const [crashed = ''] = add('image', 'crash', [{ label: 'crashed', input: { ms: 20 } }]);
    const [oom = ''] = add('image', 'oom', [{ label: 'oom', input: {} }]);
    const [weird = ''] = add('pdf', 'throw-value', [{ label: 'weird', input: {} }]);
    const ok3 = add(
      'image',
      'work',
      Array.from({ length: 10 }, (_, i) => ({ label: `ok3-${i}`, input: { ms: 20 } })),
    );
    queue.getState().start();
    await waitUntil(() => isIdle(queue));

    for (const id of [...ok1, ...ok2, ...ok3]) expect(job(queue, id).status).toBe('done');
    expect(job(queue, thrown)).toMatchObject({
      status: 'failed',
      error: 'This file is not an image',
    });
    expect(job(queue, crashed)).toMatchObject({ status: 'failed', error: queueStrings.tooLarge });
    expect(job(queue, oom)).toMatchObject({ status: 'failed', error: queueStrings.tooLarge });
    expect(job(queue, weird)).toMatchObject({ status: 'failed', error: queueStrings.failed });
    expect(queue.getState().stats).toMatchObject({ done: 12, failed: 4 });
    // The crashed and out-of-memory workers were replaced; the one that threw normally was kept.
    expect(created.filter((w) => w.terminated).length).toBeGreaterThanOrEqual(2);
  });

  it('a job whose worker cannot be created fails with a readable message', async () => {
    const { queue } = setup({
      size: 2,
      registry: {
        pdf: () => {
          throw new WorkerUnavailableError('pdf');
        },
      },
    });
    const [pdf = ''] = queue.getState().add('pdf', 'merge', [{ label: 'a.pdf', input: {} }]);
    const [img = ''] = queue
      .getState()
      .add('image', 'work', [{ label: 'a.jpg', input: { ms: 10 } }]);
    queue.getState().start();
    await waitUntil(() => isIdle(queue));
    expect(job(queue, pdf)).toMatchObject({ status: 'failed', error: queueStrings.unavailable });
    expect(job(queue, img).status).toBe('done');
  });

  it('a worker that fails to load (404) fails its job as retryable, not "too large", and frees the slot', async () => {
    // Built as a string so Vite doesn't treat it as a worker import.
    const missingUrl = new URL('/__p04-missing-worker__.js', location.origin).href;
    let offline = true;
    const goodWorker = () =>
      new Worker(new URL('./test-worker.ts', import.meta.url), { type: 'module' });
    const { queue, pool } = setup({
      size: 1,
      registry: {
        image: () => (offline ? new Worker(missingUrl, { type: 'module' }) : goodWorker()),
      },
    });
    const [img = ''] = queue
      .getState()
      .add('image', 'work', [{ label: 'a.jpg', input: { ms: 20 } }]);
    const [pdf = ''] = queue.getState().add('pdf', 'work', [{ label: 'b.pdf', input: { ms: 20 } }]);
    queue.getState().start();
    await waitUntil(() => isIdle(queue));

    expect(job(queue, img)).toMatchObject({ status: 'failed', error: queueStrings.loadFailed });
    expect(job(queue, img).error).not.toBe(queueStrings.tooLarge);
    // The slot was freed: the next job ran on the size-1 pool, and the broken worker is gone.
    expect(job(queue, pdf).status).toBe('done');
    expect(pool.stats()).toMatchObject({ busy: 0, terminated: 1 });

    offline = false;
    queue.getState().retry(img);
    await waitUntil(() => job(queue, img).status === 'done');
    expect(job(queue, img).error).toBeUndefined();
  });

  it('a worker whose script throws while loading is a load failure too', async () => {
    const source = new Blob(['throw new Error("broken worker script");'], {
      type: 'text/javascript',
    });
    const url = URL.createObjectURL(source);
    cleanups.push(() => URL.revokeObjectURL(url));
    const { queue } = setup({
      size: 2,
      registry: { pdf: () => new Worker(url, { type: 'module' }) },
    });
    const [pdf = ''] = queue.getState().add('pdf', 'merge', [{ label: 'a.pdf', input: {} }]);
    const [img = ''] = queue
      .getState()
      .add('image', 'work', [{ label: 'a.jpg', input: { ms: 20 } }]);
    queue.getState().start();
    await waitUntil(() => isIdle(queue));
    expect(job(queue, pdf)).toMatchObject({ status: 'failed', error: queueStrings.loadFailed });
    expect(job(queue, img).status).toBe('done');
  });

  it('a worker that crashes mid-job fails with "too large" and is replaced', async () => {
    const { queue, created } = setup({ size: 1 });
    const [crash = ''] = queue
      .getState()
      .add('image', 'crash', [{ label: 'huge.jpg', input: { ms: 250 } }]);
    let sawProgress = false;
    cleanups.push(
      queue.subscribe((s) => {
        const j = s.jobs.find((x) => x.id === crash);
        if (j?.status === 'working' && j.progress > 0) sawProgress = true;
      }),
    );
    const [next = ''] = queue
      .getState()
      .add('image', 'work', [{ label: 'b.jpg', input: { ms: 20 } }]);
    queue.getState().start();
    await waitUntil(() => isIdle(queue));

    expect(sawProgress).toBe(true);
    expect(job(queue, crash)).toMatchObject({ status: 'failed', error: queueStrings.tooLarge });
    expect(job(queue, next).status).toBe('done');
    // The crashed worker was terminated and a fresh one ran the next job.
    expect(created).toHaveLength(2);
    expect(created[0]?.terminated).toBe(true);
    expect(created[1]?.terminated).toBe(false);
  });

  it('a job over 40 megapixels runs alone, in its place in the line', async () => {
    const { queue } = setup({ size: 4 });
    const ids = queue.getState().add('image', 'work', [
      { label: 'a', input: { ms: 150 } },
      { label: 'b', input: { ms: 150 } },
      { label: 'huge', input: { ms: 300, width: 8000, height: 6000 } },
      { label: 'c', input: { ms: 150 } },
      { label: 'd', input: { ms: 150 } },
    ]);
    const [a = '', b = '', huge = '', c = '', d = ''] = ids;
    const violations: string[] = [];
    let maxWorking = 0;
    cleanups.push(
      queue.subscribe((s) => {
        maxWorking = Math.max(maxWorking, s.stats.working);
        const h = s.jobs.find((j) => j.id === huge);
        if (h?.status === 'working' && s.stats.working !== 1) violations.push('shared');
      }),
    );
    queue.getState().start();
    expect(statuses(queue, ids)).toEqual(['working', 'working', 'waiting', 'waiting', 'waiting']);
    await waitUntil(() => job(queue, huge).status === 'working');
    expect(statuses(queue, [a, b, c, d])).toEqual(['done', 'done', 'waiting', 'waiting']);
    await waitUntil(() => isIdle(queue));
    expect(violations).toEqual([]);
    expect(job(queue, c).startedAt).toBeGreaterThanOrEqual(job(queue, huge).endedAt ?? Infinity);
    expect(maxWorking).toBe(2);
  });

  it('a job over 100 MB runs alone', async () => {
    const { queue } = setup({ size: 4 });
    const big = new Blob([new Uint8Array(100 * 1024 * 1024 + 1)]);
    const ids = queue.getState().add('pdf', 'work', [
      { label: 'small', input: { ms: 100 } },
      { label: 'big', input: { ms: 100, file: { blob: big, name: 'big.pdf' } } },
      { label: 'small2', input: { ms: 100 } },
    ]);
    queue.getState().start();
    expect(statuses(queue, ids)).toEqual(['working', 'waiting', 'waiting']);
    await waitUntil(() => job(queue, ids[1] ?? '').status === 'working');
    expect(queue.getState().stats.working).toBe(1);
    await waitUntil(() => isIdle(queue));
  });

  it('time left is null at the start, then within ±30% of the real remaining time', async () => {
    const { queue } = setup({ size: 4 });
    // Warm the workers first, so their start-up time isn't part of the measurement.
    queue.getState().add(
      'image',
      'work',
      Array.from({ length: 4 }, () => ({ label: 'w', input: { ms: 5 } })),
    );
    queue.getState().start();
    await waitUntil(() => isIdle(queue));
    queue.getState().clear();

    const JOB_MS = 1000;
    const ids = queue.getState().add(
      'image',
      'work',
      Array.from({ length: 12 }, (_, i) => ({
        label: `even-${i}`,
        input: { ms: JOB_MS, steps: 50 },
      })),
    );
    expect(queue.getState().stats.etaSeconds).toBeNull();
    const samples: Array<{ at: number; eta: number }> = [];
    let firstNullAt: number | null = null;
    const t0 = performance.now();
    cleanups.push(
      queue.subscribe((s) => {
        const at = performance.now();
        if (s.stats.etaSeconds === null) {
          if (samples.length === 0 && s.stats.working > 0) firstNullAt ??= at;
        } else {
          samples.push({ at, eta: s.stats.etaSeconds });
        }
      }),
    );
    queue.getState().start();
    expect(queue.getState().stats.etaSeconds).toBeNull();
    await waitUntil(() => ids.every((id) => job(queue, id).status === 'done'), 15_000);
    const end = performance.now();

    expect(firstNullAt).not.toBeNull();
    expect(samples.length).toBeGreaterThan(10);
    // Not before ~4% of the run (0.12 s of 3 s).
    expect((samples[0]?.at ?? 0) - t0).toBeGreaterThan(0.03 * 3 * JOB_MS);
    // Compare while at least 0.5 s is left; very near the end any rounding is a big percentage.
    const checked = samples.filter((s) => end - s.at >= 500);
    expect(checked.length).toBeGreaterThan(10);
    const worst = Math.max(
      ...checked.map((s) => {
        const real = (end - s.at) / 1000;
        return Math.abs(s.eta - real) / real;
      }),
    );
    expect(worst).toBeLessThanOrEqual(0.3);
    expect(queue.getState().stats.etaSeconds).toBeNull();
  });

  it('keeps workers warm for reuse, then terminates them after the idle timeout', async () => {
    expect(IDLE_TIMEOUT_MS).toBe(60_000);
    const IDLE = 400;
    const { queue, pool, created, alive } = setup({ size: 2, idleMs: IDLE });
    const first = queue.getState().add('image', 'work', [
      { label: 'a', input: { ms: 20 } },
      { label: 'b', input: { ms: 20 } },
    ]);
    queue.getState().start();
    await waitUntil(() => isIdle(queue));
    const firstWorkers = first.map((id) => (job(queue, id).result as WorkResult).workerId);
    expect(alive()).toBe(2);

    // Within the idle window the same workers are reused.
    await sleep(IDLE / 4);
    const second = queue.getState().add('image', 'work', [{ label: 'c', input: { ms: 20 } }]);
    await waitUntil(() => isIdle(queue));
    expect(firstWorkers).toContain((job(queue, second[0] ?? '').result as WorkResult).workerId);
    expect(created).toHaveLength(2);

    // After the queue goes idle, no worker outlives the idle timeout.
    const idleAt = performance.now();
    await waitUntil(() => alive() === 0, IDLE * 5);
    expect(performance.now() - idleAt).toBeLessThan(IDLE + 300);
    expect(pool.stats()).toMatchObject({ live: 0, terminated: 2, created: 2 });
  });

  it('shares the pool between job kinds without going over its size', async () => {
    const { queue, pool, alive } = setup({ size: 2 });
    let maxAlive = 0;
    cleanups.push(
      queue.subscribe(() => {
        maxAlive = Math.max(maxAlive, alive(), pool.stats().live + pool.stats().starting);
      }),
    );
    const kinds = ['image', 'pdf', 'pdf', 'image', 'pdf', 'image'] as const;
    const ids = kinds.flatMap((k, i) =>
      queue.getState().add(k, 'work', [{ label: `${k}-${i}`, input: { ms: 30 } }]),
    );
    queue.getState().start();
    await waitUntil(() => isIdle(queue));
    expect(statuses(queue, ids).every((s) => s === 'done')).toBe(true);
    expect(maxAlive).toBeLessThanOrEqual(2);
  });
});
