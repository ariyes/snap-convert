import { describe, expect, it } from 'vitest';
import { applyColorTransform, iccToSrgb, nclxToSrgb } from './color';
import { applyIsoTransforms, orientPixels } from './orientation';

/** 3×2 image whose red channel is the pixel number 1–6 (row by row). */
function numbered(): ImageData {
  const img = new ImageData(3, 2);
  for (let i = 0; i < 6; i++) img.data.set([i + 1, 0, 0, 255], i * 4);
  return img;
}

const reds = (img: ImageData) => {
  const rows: number[][] = [];
  for (let y = 0; y < img.height; y++) {
    rows.push(Array.from({ length: img.width }, (_, x) => img.data[(y * img.width + x) * 4] ?? 0));
  }
  return rows;
};

describe('orientPixels', () => {
  // Stored:  1 2 3
  //          4 5 6
  it.each([
    [1, [[1, 2, 3], [4, 5, 6]]],
    [2, [[3, 2, 1], [6, 5, 4]]], // mirrored left-right
    [3, [[6, 5, 4], [3, 2, 1]]], // rotated 180°
    [4, [[4, 5, 6], [1, 2, 3]]], // mirrored top-bottom
    [5, [[1, 4], [2, 5], [3, 6]]], // transposed
    [6, [[4, 1], [5, 2], [6, 3]]], // rotated 90° clockwise
    [7, [[6, 3], [5, 2], [4, 1]]], // transverse
    [8, [[3, 6], [2, 5], [1, 4]]], // rotated 90° anti-clockwise
  ])('orientation %i', (orientation, expected) => {
    expect(reds(orientPixels(numbered(), orientation))).toEqual(expected);
  });

  it('applies HEIF irot (anti-clockwise) and imir', () => {
    expect(reds(applyIsoTransforms(numbered(), [{ rotate: 90 }]))).toEqual([[3, 6], [2, 5], [1, 4]]);
    expect(reds(applyIsoTransforms(numbered(), [{ mirror: 'vertical-axis' }]))).toEqual([[3, 2, 1], [6, 5, 4]]);
    expect(reds(applyIsoTransforms(numbered(), [{ rotate: 270 }, { mirror: 'horizontal-axis' }]))).toEqual([[6, 3], [5, 2], [4, 1]]);
  });
});

describe('colour conversion to sRGB', () => {
  const pixel = (r: number, g: number, b: number) => {
    const img = new ImageData(1, 1);
    img.data.set([r, g, b, 200]);
    return img;
  };

  it('Display P3 (nclx): greys stay grey, saturated colours map into sRGB, alpha untouched', () => {
    const t = nclxToSrgb({ primaries: 12, transfer: 13 });
    expect(t).toBeDefined();
    if (!t) return;
    const grey = pixel(128, 128, 128);
    applyColorTransform(grey, t);
    expect(Array.from(grey.data)).toEqual([128, 128, 128, 200]);
    // P3 (200, 100, 50) is a more saturated orange than sRGB (200, 100, 50).
    const orange = pixel(200, 100, 50);
    applyColorTransform(orange, t);
    const [r, g, b, a] = Array.from(orange.data);
    expect(r).toBeGreaterThanOrEqual(212);
    expect(g).toBeLessThanOrEqual(98);
    expect(b).toBeLessThanOrEqual(42);
    expect(a).toBe(200);
  });

  it('sRGB and unspecified colour need no conversion', () => {
    expect(nclxToSrgb({ primaries: 1, transfer: 13 })).toBeUndefined();
    expect(nclxToSrgb({ primaries: 2, transfer: 2 })).toBeUndefined();
    expect(nclxToSrgb({ primaries: 9, transfer: 16 })).toBeUndefined(); // HDR (PQ) is left alone
  });

  it('rejects ICC data that is not an RGB matrix profile', () => {
    expect(iccToSrgb(new Uint8Array(10))).toBeUndefined();
    expect(iccToSrgb(new Uint8Array(200))).toBeUndefined();
  });
});
