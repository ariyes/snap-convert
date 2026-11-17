import { describe, expect, it } from 'vitest';
import type { Attempt } from './attempt';
import { findQualityForTarget, sizeForTarget, verifySuggestedSize, type SizeTry } from './target';

/** A fake encoder: file size and score as functions of quality; counts calls. */
function fakeEncoder(bytes: (q: number) => number, score: (q: number) => number = () => 0.99) {
  const calls: number[] = [];
  const encodeAt = (quality: number): Promise<Attempt> => {
    calls.push(quality);
    const size = bytes(quality);
    return Promise.resolve({ quality, blob: new Blob([]), bytes: size, ssim: score(quality) });
  };
  return { encodeAt, calls };
}

/** Typical JPEG curve: size grows faster toward the top of the scale. */
const jpegLike = (q: number) => Math.round(20_000 * Math.exp(q / 25));

describe('findQualityForTarget', () => {
  it('monotonic curve: finds the highest quality that fits, in ≤ 7 encodes', async () => {
    // jpegLike: quality 60 ≈ 220 KB, 80 ≈ 490 KB.
    for (const target of [221_000, 260_000, 300_000, 400_000, 480_000]) {
      const { encodeAt, calls } = fakeEncoder(jpegLike);
      const r = await findQualityForTarget(encodeAt, { targetBytes: target, maxQuality: 80 });
      expect(r.reached).toBe(true);
      expect(r.best.bytes).toBeLessThanOrEqual(target);
      // The next quality up would not fit (or the answer is the ceiling).
      if (r.best.quality < 80) expect(jpegLike(r.best.quality + 1)).toBeGreaterThan(target);
      expect(r.best.quality).toBeGreaterThanOrEqual(60);
      expect(calls.length).toBeLessThanOrEqual(7);
      expect(new Set(calls).size).toBe(calls.length); // never encodes the same quality twice
    }
  });

  it('takes the ceiling in one encode when it already fits', async () => {
    const { encodeAt, calls } = fakeEncoder(jpegLike);
    const r = await findQualityForTarget(encodeAt, { targetBytes: 10_000_000, maxQuality: 80 });
    expect(r).toMatchObject({ reached: true, encodes: 1 });
    expect(r.best.quality).toBe(80);
    expect(calls).toEqual([80]);
  });

  it('stays within 7 encodes for the widest range (60–100)', async () => {
    for (let target = 50_000; target < 1_100_000; target += 37_000) {
      const { encodeAt, calls } = fakeEncoder(jpegLike);
      const r = await findQualityForTarget(encodeAt, { targetBytes: target, maxQuality: 100 });
      expect(calls.length).toBeLessThanOrEqual(7);
      if (jpegLike(60) <= target) {
        expect(r.reached).toBe(true);
        if (r.best.quality < 100) expect(jpegLike(r.best.quality + 1)).toBeGreaterThan(target);
      }
    }
  });

  it('flat curve (quality makes no difference): reachable or not, decided quickly', async () => {
    const fits = fakeEncoder(() => 150_000);
    const yes = await findQualityForTarget(fits.encodeAt, { targetBytes: 200_000, maxQuality: 80 });
    expect(yes).toMatchObject({ reached: true, encodes: 1 });

    const over = fakeEncoder(() => 250_000);
    const no = await findQualityForTarget(over.encodeAt, {
      targetBytes: 200_000,
      maxQuality: 80,
      size: { width: 4000, height: 3000 },
    });
    expect(no.reached).toBe(false);
    expect(no.best.quality).toBe(60); // the floor
    expect(over.calls.length).toBeLessThanOrEqual(7);
    expect(no.suggestedSize).toBeDefined();
  });

  it('unreachable: never goes below quality 60, returns the floor and a smaller size', async () => {
    const { encodeAt, calls } = fakeEncoder(jpegLike);
    const r = await findQualityForTarget(encodeAt, {
      targetBytes: 50_000, // even quality 60 is ~220 KB
      maxQuality: 80,
      size: { width: 4032, height: 3024 },
    });
    expect(r.reached).toBe(false);
    expect(r.best.quality).toBe(60);
    expect(Math.min(...calls)).toBe(60);
    expect(calls.length).toBeLessThanOrEqual(7);
    const s = r.suggestedSize!;
    expect(s.width).toBeLessThan(4032);
    expect(s.width / s.height).toBeCloseTo(4032 / 3024, 2); // never stretched
  });

  it('never accepts a result below SSIM 0.95: stops at the visual floor instead', async () => {
    // Fits from quality 70 down, but anything below 75 scores under 0.95.
    const bytes = (q: number) => q * 10_000;
    const score = (q: number) => (q >= 75 ? 0.96 : 0.93);
    const { encodeAt } = fakeEncoder(bytes, score);
    const r = await findQualityForTarget(encodeAt, {
      targetBytes: 700_000,
      maxQuality: 90,
      size: { width: 2000, height: 1000 },
    });
    expect(r.reached).toBe(false);
    expect(r.best.ssim).toBeGreaterThanOrEqual(0.95);
    expect(r.best.quality).toBeGreaterThanOrEqual(75);
    expect(r.suggestedSize).toBeDefined();
  });

  it('stops early when a result is both too big and below the visual floor', async () => {
    const { encodeAt, calls } = fakeEncoder(
      () => 900_000,
      (q) => (q >= 78 ? 0.96 : 0.9),
    );
    const r = await findQualityForTarget(encodeAt, { targetBytes: 100_000, maxQuality: 80 });
    expect(r.reached).toBe(false);
    expect(calls.length).toBe(2); // 80, then 70 (too big and too soft: nothing can work)
    expect(r.best.quality).toBe(80);
  });

  it('too soft at the ceiling (heavy grain): goes up to the lowest quality scoring ≥ 0.95', async () => {
    const score = (q: number) => (q >= 86 ? 0.96 : 0.91);
    const roomy = fakeEncoder((q) => q * 10_000, score);
    const r = await findQualityForTarget(roomy.encodeAt, {
      targetBytes: 10_000_000,
      maxQuality: 80,
    });
    expect(r.reached).toBe(true);
    expect(r.best.quality).toBe(86);
    expect(roomy.calls.length).toBeLessThanOrEqual(7);

    const tight = fakeEncoder((q) => q * 10_000, score);
    const no = await findQualityForTarget(tight.encodeAt, {
      targetBytes: 500_000,
      maxQuality: 80,
      size: { width: 1000, height: 800 },
    });
    expect(no.reached).toBe(false);
    expect(no.best.quality).toBe(86); // the floor: lowest quality that still looks right
    expect(no.best.ssim).toBeGreaterThanOrEqual(0.95);
    expect(tight.calls.length).toBeLessThanOrEqual(7);
    expect(no.suggestedSize).toBeDefined();
  });

  it('never returns a result under 0.95 when one at or above it was found', async () => {
    for (const ceiling of [60, 70, 80, 90]) {
      for (const target of [100_000, 600_000, 900_000, 5_000_000]) {
        const { encodeAt, calls } = fakeEncoder(
          (q) => q * 10_000,
          (q) => 0.8 + q / 500, // 0.95 from quality 75
        );
        const r = await findQualityForTarget(encodeAt, {
          targetBytes: target,
          maxQuality: ceiling,
        });
        expect(r.best.ssim).toBeGreaterThanOrEqual(0.95);
        expect(calls.length).toBeLessThanOrEqual(7);
        if (r.reached) expect(r.best.bytes).toBeLessThanOrEqual(target);
      }
    }
  });

  it('reports progress before each encode', async () => {
    const seen: number[] = [];
    const { encodeAt } = fakeEncoder(jpegLike);
    await findQualityForTarget(encodeAt, {
      targetBytes: 200_000,
      maxQuality: 80,
      onEncode: (done) => seen.push(done),
    });
    expect(seen[0]).toBe(0);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe('sizeForTarget', () => {
  it('scales down by the sizing rule, keeping the aspect ratio', () => {
    const s = sizeForTarget({ width: 4032, height: 3024 }, 1_200_000, 200_000);
    expect(s.width).toBeLessThan(4032);
    expect(s.width).toBeGreaterThan(800);
    expect(Math.abs(s.width / s.height - 4 / 3)).toBeLessThan(0.01);
  });

  it('returns the same size when the file already fits', () => {
    expect(sizeForTarget({ width: 100, height: 50 }, 1000, 2000)).toEqual({
      width: 100,
      height: 50,
    });
  });
});

describe('verifySuggestedSize', () => {
  /** A photo whose file is `perPixel` bytes per pixel at any size (the estimate is optimistic). */
  const photo = (perPixel: number, target: number) => {
    const tried: number[] = [];
    const tryAt = (s: { width: number; height: number }): Promise<SizeTry> => {
      tried.push(Math.max(s.width, s.height));
      const bytes = s.width * s.height * perPixel;
      return Promise.resolve({ bytes, reached: bytes <= target });
    };
    return { tried, tryAt };
  };

  it('keeps a suggestion that fits after one try', async () => {
    const { tried, tryAt } = photo(0.1, 100_000);
    const result = await verifySuggestedSize({ width: 1000, height: 750 }, 100_000, tryAt);
    expect(result).toEqual({ size: { width: 1000, height: 750 }, verified: true, tries: 1 });
    expect(tried).toEqual([1000]);
  });

  it('steps an optimistic suggestion down until it fits (never stretched)', async () => {
    const { tried, tryAt } = photo(0.2, 100_000);
    const result = await verifySuggestedSize({ width: 1000, height: 750 }, 100_000, tryAt);
    expect(result.verified).toBe(true);
    expect(result.tries).toBeGreaterThan(1);
    expect(result.tries).toBeLessThanOrEqual(3);
    expect(result.size.width * result.size.height * 0.2).toBeLessThanOrEqual(100_000);
    expect(Math.abs(result.size.width / result.size.height - 4 / 3)).toBeLessThan(0.01);
    // Every try is smaller than the one before.
    expect(tried.every((px, i) => i === 0 || px < (tried[i - 1] ?? Infinity))).toBe(true);
  });

  it("uses the job's own next suggestion when it gives one", async () => {
    const sizes: number[] = [];
    const result = await verifySuggestedSize({ width: 900, height: 600 }, 50_000, (s) => {
      sizes.push(s.width);
      return Promise.resolve(
        s.width === 900
          ? { bytes: 80_000, reached: false, suggestedSize: { width: 600, height: 400 } }
          : { bytes: 40_000, reached: true },
      );
    });
    expect(sizes).toEqual([900, 600]);
    expect(result).toEqual({ size: { width: 600, height: 400 }, verified: true, tries: 2 });
  });

  it('gives up after three tries and offers the next smaller size unverified', async () => {
    // Always twice the target, whatever the size (a file that won't shrink).
    const tried: number[] = [];
    const tryAt = (s: { width: number; height: number }): Promise<SizeTry> => {
      tried.push(Math.max(s.width, s.height));
      return Promise.resolve({ bytes: 2_000, reached: false });
    };
    const result = await verifySuggestedSize({ width: 2000, height: 1000 }, 1_000, tryAt);
    expect(tried).toHaveLength(3);
    expect(result.verified).toBe(false);
    expect(result.tries).toBe(3);
    expect(Math.max(result.size.width, result.size.height)).toBeLessThan(tried[2] ?? 0);
  });

  it('always moves at least 10% smaller, even when the estimate barely changes', async () => {
    const sizes: number[] = [];
    await verifySuggestedSize({ width: 1000, height: 1000 }, 99_999, (s) => {
      sizes.push(s.width);
      return Promise.resolve({ bytes: 100_000, reached: false });
    });
    expect(sizes[1]).toBeLessThanOrEqual(900);
  });
});
