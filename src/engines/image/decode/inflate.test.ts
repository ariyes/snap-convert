import { zlibSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflate } from './inflate';

const data = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7) % 251);
const compressed = zlibSync(data);

describe('inflate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('inflates with DecompressionStream', async () => {
    expect(await inflate(compressed)).toEqual(data);
  });

  it('falls back to fflate where DecompressionStream is missing (Safari < 16.4)', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    expect(await inflate(compressed)).toEqual(data);
  });

  it('tolerates junk after the end of the stream', async () => {
    const junk = new Uint8Array(compressed.length + 5);
    junk.set(compressed);
    junk.set([1, 2, 3, 4, 5], compressed.length);
    const out = await inflate(junk, data.length);
    expect(out.subarray(0, data.length)).toEqual(data);
  });

  it('stops early once maxBytes are out (no zip bombs)', async () => {
    const zeros = zlibSync(new Uint8Array(50_000_000));
    const out = await inflate(zeros, 1000);
    expect(out.length).toBeGreaterThanOrEqual(1000);
    expect(out.length).toBeLessThan(50_000_000);
  });

  it('throws on broken data, with and without DecompressionStream', async () => {
    const broken = compressed.slice(0, 100);
    broken[50] = broken[50]! ^ 0xff;
    await expect(inflate(broken, data.length)).rejects.toThrow();
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(inflate(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
