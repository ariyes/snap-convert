import { describe, expect, it } from 'vitest';
import { PageRunner, runStats, type PageWorkContext } from './runner';

interface Deferred {
  page: number;
  ctx: PageWorkContext;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
}

/** A runner whose work waits until the test settles each page. */
function setup(concurrency = 2) {
  const calls: Deferred[] = [];
  const runner = new PageRunner<string>(
    (page, ctx) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ page, ctx, resolve, reject });
        ctx.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          {
            once: true,
          },
        );
      }),
    { concurrency, describeError: (e) => (e instanceof Error ? e.message : 'failed') },
  );
  const call = (page: number) => {
    const found = [...calls].reverse().find((c) => c.page === page);
    if (!found) throw new Error(`page ${page} never started`);
    return found;
  };
  return { runner, calls, call };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const statuses = (runner: PageRunner<string>) => runner.tasks.map((t) => `${t.page}:${t.status}`);

describe('PageRunner', () => {
  it('keeps at most `concurrency` pages in flight, so memory stays flat', async () => {
    const { runner, calls, call } = setup(4);
    let maxActive = 0;
    runner.subscribe(() => (maxActive = Math.max(maxActive, runner.active)));
    runner.start(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3, 4]);
    for (let page = 1; page <= 100; page++) {
      call(page).resolve(`img${page}`);
      await flush();
      expect(runner.active).toBeLessThanOrEqual(4);
    }
    expect(maxActive).toBe(4);
    expect(runStats(runner.tasks)).toMatchObject({ total: 100, done: 100, running: false });
    expect(runner.tasks[56]).toMatchObject({ page: 57, status: 'done', result: 'img57' });
  });

  it('reports each page’s stage and progress', async () => {
    const { runner, call } = setup();
    runner.start([3]);
    expect(statuses(runner)).toEqual(['3:rendering']);
    call(3).ctx.stage('encoding');
    call(3).ctx.progress(0.5);
    expect(runner.tasks[0]).toMatchObject({ status: 'encoding', progress: 0.5 });
    expect(runStats(runner.tasks).progress).toBe(0.5);
    call(3).resolve('x');
    await flush();
    expect(runner.tasks[0]).toMatchObject({ status: 'done', progress: 1, result: 'x' });
  });

  it('cancel stops running and waiting pages and keeps finished ones', async () => {
    const { runner, calls, call } = setup();
    runner.start([1, 2, 3, 4]);
    call(1).resolve('one');
    await flush();
    expect(calls).toHaveLength(3);
    runner.cancel();
    expect(call(2).ctx.signal.aborted).toBe(true);
    expect(call(3).ctx.signal.aborted).toBe(true);
    await flush();
    expect(statuses(runner)).toEqual(['1:done', '2:cancelled', '3:cancelled', '4:cancelled']);
    expect(calls).toHaveLength(3); // page 4 never started
    expect(runStats(runner.tasks)).toMatchObject({ done: 1, stopped: 3, running: false });
  });

  it('a failed page shows its message and can be retried on its own', async () => {
    const { runner, call } = setup();
    runner.start([1, 2]);
    call(1).reject(new Error('Out of memory'));
    call(2).resolve('two');
    await flush();
    expect(runner.tasks[0]).toMatchObject({ status: 'failed', error: 'Out of memory' });
    runner.retry(2); // done pages are not run again
    runner.retry(1);
    expect(statuses(runner)).toEqual(['1:rendering', '2:done']);
    call(1).resolve('one');
    await flush();
    expect(statuses(runner)).toEqual(['1:done', '2:done']);
    expect(runner.tasks[0]!.error).toBeUndefined();
  });

  it('retryAll runs every failed and stopped page again', async () => {
    const { runner, call } = setup(1);
    runner.start([1, 2, 3]);
    call(1).reject(new Error('bad'));
    await flush();
    runner.cancel();
    await flush();
    expect(statuses(runner)).toEqual(['1:failed', '2:cancelled', '3:cancelled']);
    runner.retryAll();
    expect(statuses(runner)).toEqual(
      ['1:waiting', '2:waiting', '3:waiting'].map((s, i) => (i === 0 ? '1:rendering' : s)),
    );
    for (const page of [1, 2, 3]) {
      call(page).resolve(`p${page}`);
      await flush();
    }
    expect(runStats(runner.tasks).done).toBe(3);
  });

  it('dispose cancels everything and stops reporting (leaving the page)', async () => {
    const { runner, call } = setup();
    const seen: number[] = [];
    runner.subscribe((tasks) => seen.push(tasks.length));
    runner.start([1, 2, 3]);
    const before = seen.length;
    runner.dispose();
    expect(call(1).ctx.signal.aborted).toBe(true);
    expect(call(2).ctx.signal.aborted).toBe(true);
    await flush();
    expect(seen.length).toBe(before);
    runner.start([1]);
    runner.retry(1);
    expect(runner.active).toBe(0);
  });

  it('starting again replaces the previous run', async () => {
    const { runner, call } = setup();
    runner.start([1, 2]);
    const first = call(1);
    runner.start([5]);
    expect(first.ctx.signal.aborted).toBe(true);
    await flush();
    expect(statuses(runner)).toEqual(['5:rendering']);

    // The same page again: the old, cancelled run never overwrites the new one.
    runner.start([1]);
    await flush();
    expect(statuses(runner)).toEqual(['1:rendering']);
    call(1).resolve('fresh');
    await flush();
    expect(runner.tasks[0]).toMatchObject({ status: 'done', result: 'fresh' });
  });
});
