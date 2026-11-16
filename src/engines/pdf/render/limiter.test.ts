import { describe, expect, it } from 'vitest';
import { Limiter } from './limiter';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Limiter', () => {
  it('grants at most `max` slots, first come first served', async () => {
    const limiter = new Limiter(2);
    const order: number[] = [];
    const releases: Array<() => void> = [];
    for (const n of [1, 2, 3, 4]) {
      void limiter.acquire().then((release) => {
        order.push(n);
        releases.push(release);
      });
    }
    await tick();
    expect(order).toEqual([1, 2]);
    expect(limiter.active).toBe(2);

    releases[0]!();
    releases[0]!(); // releasing twice frees only one slot
    await tick();
    expect(order).toEqual([1, 2, 3]);
    expect(limiter.active).toBe(2);

    releases[1]!();
    await tick();
    expect(order).toEqual([1, 2, 3, 4]);
    releases[2]!();
    releases[3]!();
    expect(limiter.active).toBe(0);
  });

  it('drops aborted waiters from the queue and rejects them', async () => {
    const limiter = new Limiter(1);
    const first = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    const next = limiter.acquire();
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });

    first();
    const release = await next;
    expect(limiter.active).toBe(1);
    release();
    expect(limiter.active).toBe(0);
  });

  it('rejects straight away when the signal is already aborted', async () => {
    const limiter = new Limiter(1);
    await expect(limiter.acquire(AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(limiter.active).toBe(0);
  });
});
