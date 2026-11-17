import { describe, expect, it } from 'vitest';
import { PAGE_IMAGE_LIMITS, pageImageSize } from './page-image-size';

const A4 = { width: 595.28, height: 841.89 };
const A0 = { width: 2383.94, height: 3370.39 };
const LETTER_LANDSCAPE = { width: 792, height: 612 };

describe('pageImageSize', () => {
  it('is page size × dpi / 72, both sides from one scale', () => {
    expect(pageImageSize(A4, 150)).toMatchObject({
      width: 1240,
      height: 1754,
      dpi: 150,
      reduced: false,
    });
    expect(pageImageSize(A4, 72)).toMatchObject({ width: 595, height: 842 });
    expect(pageImageSize(A4, 300)).toMatchObject({ width: 2480, height: 3508 });
    const s = pageImageSize(A4, 150);
    expect(s.scale).toBeCloseTo(1754 / 841.89, 10);
    // Never stretched: the aspect ratio is kept within rounding of the short side.
    expect(Math.abs(s.width - A4.width * s.scale)).toBeLessThanOrEqual(0.5);
  });

  it('keeps landscape pages landscape', () => {
    expect(pageImageSize(LETTER_LANDSCAPE, 150)).toMatchObject({ width: 1650, height: 1275 });
  });

  it('draws small pages larger: a PDF page is vector, so this sharpens it', () => {
    expect(pageImageSize({ width: 200, height: 100 }, 600)).toMatchObject({
      width: 1667,
      height: 834,
      reduced: false,
    });
  });

  it('caps a 300 dpi A0 page at 50 MP with the largest whole DPI that fits', () => {
    const s = pageImageSize(A0, 300);
    expect(s.reduced).toBe(true);
    expect(s.dpi).toBe(179);
    expect(s.width * s.height).toBeLessThanOrEqual(PAGE_IMAGE_LIMITS.maxPixels);
    // One more DPI would not fit.
    expect(pageImageSize(A0, 180).reduced).toBe(true);
    expect(pageImageSize(A0, 179)).toMatchObject({ reduced: false, width: s.width });
  });

  it('uses the smaller limit on devices that cannot draw 50 MP', () => {
    const s = pageImageSize(A0, 300, PAGE_IMAGE_LIMITS.smallDevicePixels);
    expect(s.reduced).toBe(true);
    expect(s.width * s.height).toBeLessThanOrEqual(16_000_000);
    expect(s.dpi).toBe(101);
  });

  it('keeps the longest side within 16384 px', () => {
    const strip = { width: 72 * 100, height: 72 }; // 100 × 1 inch
    const s = pageImageSize(strip, 300);
    expect(s.reduced).toBe(true);
    expect(s.width).toBeLessThanOrEqual(16_384);
    expect(s.dpi).toBe(163);
    expect(s.height).toBe(Math.round(16_300 / 100));
  });

  it('still returns a size for absurdly large pages', () => {
    const huge = { width: 14_400 * 75, height: 14_400 * 75 }; // UserUnit 75
    const s = pageImageSize(huge, 150);
    expect(s.reduced).toBe(true);
    expect(s.width * s.height).toBeLessThanOrEqual(PAGE_IMAGE_LIMITS.maxPixels);
    expect(s.width).toBe(s.height);
    expect(s.dpi).toBeGreaterThan(0);
  });

  it('rejects bad input', () => {
    expect(() => pageImageSize(A4, 0)).toThrow(RangeError);
    expect(() => pageImageSize(A4, Number.NaN)).toThrow(RangeError);
    expect(() => pageImageSize({ width: 0, height: 10 }, 150)).toThrow(RangeError);
  });
});
