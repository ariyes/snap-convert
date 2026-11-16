import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixelRatio, thumbnailCanvasSize, thumbnailLongSide } from './size';

describe('thumbnail size', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('multiplies the CSS size by the device pixel ratio, clamped to 1–3', () => {
    expect(thumbnailLongSide(120, 1)).toBe(120);
    expect(thumbnailLongSide(120, 2)).toBe(240);
    expect(thumbnailLongSide(100, 1.5)).toBe(150);

    vi.stubGlobal('devicePixelRatio', 2);
    expect(pixelRatio()).toBe(2);
    vi.stubGlobal('devicePixelRatio', 5);
    expect(pixelRatio()).toBe(3);
    vi.stubGlobal('devicePixelRatio', 0.5);
    expect(pixelRatio()).toBe(1);
  });

  it('rejects sizes that are not positive', () => {
    expect(() => thumbnailLongSide(0, 1)).toThrow(RangeError);
    expect(() => thumbnailLongSide(Number.NaN, 1)).toThrow(RangeError);
  });

  it('fits the long side and keeps the aspect ratio', () => {
    const a4 = thumbnailCanvasSize({ width: 595.28, height: 841.89 }, 200);
    expect(a4).toMatchObject({ width: 141, height: 200 });
    expect(a4.scale).toBeCloseTo(200 / 841.89);

    const landscape = thumbnailCanvasSize({ width: 792, height: 612 }, 200);
    expect(landscape).toMatchObject({ width: 200, height: 155 });

    // Small pages are rasterised larger (vector content), still unstretched.
    const tiny = thumbnailCanvasSize({ width: 200, height: 100 }, 400);
    expect(tiny).toMatchObject({ width: 400, height: 200, scale: 2 });
  });

  it('never returns a zero side for extreme aspect ratios', () => {
    expect(thumbnailCanvasSize({ width: 10_000, height: 1 }, 100)).toMatchObject({
      width: 100,
      height: 1,
    });
  });
});
