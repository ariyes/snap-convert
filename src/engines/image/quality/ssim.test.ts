import { describe, expect, it } from 'vitest';
import type { Pixels } from './pixels';
import { ssim } from './ssim';
import { mulberry32, photoLike } from './testing/synthetic';

function withNoise(img: Pixels, amount: number, seed = 1): Pixels {
  const rand = mulberry32(seed);
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c]! + (rand() * 2 - 1) * amount;
  }
  return { width: img.width, height: img.height, data };
}

function solid(width: number, height: number, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

describe('ssim', () => {
  const img = photoLike(160, 120, { seed: 4 });

  it('is 1 for identical images', () => {
    expect(ssim(img, img)).toBe(1);
  });

  it('drops as distortion grows, and is symmetric', () => {
    const light = withNoise(img, 4);
    const heavy = withNoise(img, 30);
    expect(ssim(img, light)).toBeLessThan(1);
    expect(ssim(img, heavy)).toBeLessThan(ssim(img, light));
    expect(ssim(img, heavy)).toBeCloseTo(ssim(heavy, img), 10);
  });

  it('scores a small shift of the picture below a small amount of noise', () => {
    const shifted: Pixels = {
      width: img.width,
      height: img.height,
      data: new Uint8ClampedArray(img.data.length),
    };
    shifted.data.set(img.data.subarray(8)); // two pixels to the left
    expect(ssim(img, shifted)).toBeLessThan(ssim(img, withNoise(img, 2)));
  });

  it('ignores colour hidden under fully transparent pixels', () => {
    const a = solid(16, 16, [255, 0, 0, 0]);
    const b = solid(16, 16, [0, 0, 255, 0]);
    expect(ssim(a, b)).toBe(1);
    expect(ssim(solid(16, 16, [0, 0, 0, 255]), solid(16, 16, [0, 0, 0, 0]))).toBeLessThan(0.1);
  });

  it('handles images smaller than one 8×8 window', () => {
    const tiny = photoLike(5, 3, { seed: 2 });
    expect(ssim(tiny, tiny)).toBe(1);
    expect(ssim(tiny, withNoise(tiny, 40))).toBeLessThan(1);
  });

  it('rejects images of different sizes or broken pixel data', () => {
    expect(() => ssim(img, photoLike(120, 160))).toThrow(/differ in size/);
    expect(() => ssim({ width: 2, height: 2, data: new Uint8ClampedArray(3) }, img)).toThrow(
      RangeError,
    );
  });
});
