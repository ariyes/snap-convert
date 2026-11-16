import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_CACHE_TTL_MS } from './documents';
import { IdleCache } from './idle-cache';

describe('IdleCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const created: string[] = [];
    const disposed: string[] = [];
    const cache = new IdleCache<object, string>(
      DOCUMENT_CACHE_TTL_MS,
      () => {
        const value = `doc${created.length + 1}`;
        created.push(value);
        return value;
      },
      (value) => disposed.push(value),
    );
    return { cache, created, disposed };
  }

  it('uses a 60 s idle time for PDF documents', () => {
    expect(DOCUMENT_CACHE_TTL_MS).toBe(60_000);
  });

  it('shares one value per key and disposes it 60 s after the last use', async () => {
    const { cache, created, disposed } = setup();
    const file = {};
    await cache.use(file, (v) => Promise.resolve(v));
    await cache.use(file, (v) => Promise.resolve(v));
    expect(created).toEqual(['doc1']);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(disposed).toEqual([]);
    expect(cache.has(file)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(disposed).toEqual(['doc1']);
    expect(cache.has(file)).toBe(false);

    await cache.use(file, (v) => Promise.resolve(v));
    expect(created).toEqual(['doc1', 'doc2']);
  });

  it('restarts the clock on reuse and never disposes a value in use', async () => {
    const { cache, disposed } = setup();
    const file = {};
    await cache.use(file, (v) => Promise.resolve(v));
    await vi.advanceTimersByTimeAsync(50_000);

    let finish = () => {};
    const busy = cache.use(file, () => new Promise<void>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(disposed).toEqual([]);

    finish();
    await busy;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(disposed).toEqual(['doc1']);
  });

  it('keeps separate values per key', async () => {
    const { cache, created } = setup();
    await cache.use({}, (v) => Promise.resolve(v));
    await cache.use({}, (v) => Promise.resolve(v));
    expect(created).toEqual(['doc1', 'doc2']);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
