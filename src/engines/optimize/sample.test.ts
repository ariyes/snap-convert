import { describe, expect, it } from 'vitest';
import type { Attempt } from './attempt';
import { guardPlan } from './guard';
import {
  cutSample,
  GUARD_SAMPLE,
  guardFromPrediction,
  predictGuardQuality,
  sampleGrid,
  usesGuardSample,
} from './sample';

function attempt(quality: number, ssim: number): Attempt {
  return { quality, blob: new Blob([]), bytes: quality * 1000, ssim };
}

function encoder(score: (q: number) => number) {
  const calls: number[] = [];
  return {
    calls,
    encodeAt: (q: number) => {
      calls.push(q);
      return Promise.resolve(attempt(q, score(q)));
    },
  };
}

describe('usesGuardSample', () => {
  it('samples JPEG and WebP above 8 MP only', () => {
    const big = { width: 8000, height: 6000 };
    const phone = { width: 4032, height: 3024 };
    const portrait = { width: 2448, height: 3264 };
    expect(usesGuardSample('jpeg', big)).toBe(true);
    expect(usesGuardSample('webp', big)).toBe(true);
    expect(usesGuardSample('jpeg', phone)).toBe(true);
    expect(usesGuardSample('jpeg', portrait)).toBe(false);
    // AVIF's encoder speed depends on the pixel count (and D31 caps it); PNG has no guard.
    expect(usesGuardSample('avif', big)).toBe(false);
    expect(usesGuardSample('png', big)).toBe(false);
  });

  it('can be forced on (tests) for anything bigger than the sample, or off', () => {
    expect(usesGuardSample('jpeg', { width: 2448, height: 3264 }, 'always')).toBe(true);
    expect(usesGuardSample('jpeg', { width: 1000, height: 1000 }, 'always')).toBe(false);
    expect(usesGuardSample('jpeg', { width: 8000, height: 6000 }, 'never')).toBe(false);
    // Too thin for a tile.
    expect(usesGuardSample('jpeg', { width: 100_000, height: 100 }, 'always')).toBe(false);
  });
});

describe('sampleGrid', () => {
  it.each([
    [8000, 6000],
    [6000, 8000],
    [4032, 3024],
    [12_000, 1000],
    [3001, 2999],
  ])('%i×%i: tiles on the 16 px grid, inside the image, within the budget', (width, height) => {
    const g = sampleGrid({ width, height });
    const { tile, align, maxPixels } = GUARD_SAMPLE;
    expect(g.cols * g.rows * tile * tile).toBeLessThanOrEqual(maxPixels);
    expect(g.xs).toHaveLength(g.cols);
    expect(g.ys).toHaveLength(g.rows);
    for (const [starts, length] of [
      [g.xs, width],
      [g.ys, height],
    ] as const) {
      for (const s of starts) {
        expect(s % align).toBe(0);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s + tile).toBeLessThanOrEqual(length);
      }
      // Spread over the whole image, in order (snapping to the grid may overlap them by < 16 px).
      for (let i = 1; i < starts.length; i++)
        expect(starts[i]! - starts[i - 1]!).toBeGreaterThan(tile - align);
      expect(starts[0]!).toBeLessThan(length / starts.length);
      expect(starts.at(-1)! + tile).toBeGreaterThan(length - length / starts.length);
    }
  });

  it('48 MP: about 2 MP of tiles, shaped like the image, the same every time', () => {
    const g = sampleGrid({ width: 8000, height: 6000 });
    expect(g.cols * g.rows * 128 * 128).toBeGreaterThan(1_800_000);
    expect(g.cols / g.rows).toBeCloseTo(8000 / 6000, 0);
    expect(sampleGrid({ width: 8000, height: 6000 })).toEqual(g);
  });
});

describe('cutSample', () => {
  it('copies the tiles side by side, pixel for pixel', () => {
    const width = 1000;
    const height = 700;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++)
        data.set([x & 255, x >> 8, y & 255, y >> 8], (y * width + x) * 4);
    }
    const grid = sampleGrid({ width, height }, 6 * 128 * 128);
    const s = cutSample({ width, height, data }, grid);
    expect(s.width).toBe(grid.cols * 128);
    expect(s.height).toBe(grid.rows * 128);
    for (const [c, r, dx, dy] of [
      [0, 0, 0, 0],
      [grid.cols - 1, grid.rows - 1, 127, 127],
      [1, 0, 5, 77],
    ] as const) {
      const i = ((r * 128 + dy) * s.width + c * 128 + dx) * 4;
      const x = grid.xs[c]! + dx;
      const y = grid.ys[r]! + dy;
      expect([...s.data.subarray(i, i + 4)]).toEqual([x & 255, x >> 8, y & 255, y >> 8]);
    }
  });
});

describe('sampled guard', () => {
  const plan = guardPlan('jpeg', 80);

  it('predicts where the guard stops: the lowest step reaching 0.97', async () => {
    const sample = encoder((q) => (q >= 88 ? 0.975 : 0.95));
    const p = await predictGuardQuality(attempt(80, 0.93), sample.encodeAt, plan);
    expect(p).toEqual({ quality: 88, steps: 2, reached: true, encodes: 3 });
  });

  it('then one full-size encode at that quality is enough when it scores 0.97', async () => {
    const full = encoder(() => 0.99);
    const r = await guardFromPrediction(
      attempt(88, 0.972),
      full.encodeAt,
      { quality: 88, steps: 2, reached: true, encodes: 3 },
      plan,
    );
    expect(full.calls).toEqual([]);
    expect(r).toMatchObject({ steps: 2, reached: true });
    expect(r.best.quality).toBe(88);
  });

  it('an optimistic sample: carries on up the steps at full size, at most 2 more', async () => {
    const full = encoder((q) => (q >= 96 ? 0.97 : 0.95 + q / 10_000)); // 92 → 0.9592
    const r = await guardFromPrediction(
      attempt(84, 0.955),
      full.encodeAt,
      { quality: 84, steps: 1, reached: true, encodes: 2 },
      plan,
    );
    expect(full.calls).toEqual([88, 92]); // capped: no last-resort steps past 2
    expect(r).toMatchObject({ steps: 3, reached: false });
    expect(r.best.quality).toBe(92);
  });

  it('0.97 out of reach on the sample: no more steps to 92, only the 0.95 floor', async () => {
    const sample = encoder((q) => 0.9 + q / 2000); // 84 → 0.942 … 92 → 0.946
    const p = await predictGuardQuality(attempt(80, 0.955), sample.encodeAt, plan);
    expect(p).toMatchObject({ quality: 80, steps: 3, reached: false });
    const full = encoder(() => 0.99);
    const r = await guardFromPrediction(attempt(80, 0.956), full.encodeAt, p, plan);
    expect(full.calls).toEqual([]);
    expect(r).toMatchObject({ steps: 3, reached: false });

    const below = encoder((q) => (q >= 96 ? 0.951 : 0.94));
    const floor = await guardFromPrediction(attempt(92, 0.945), below.encodeAt, p, plan);
    expect(below.calls).toEqual([96]);
    expect(floor.best.ssim).toBeGreaterThanOrEqual(0.95);
  });
});
