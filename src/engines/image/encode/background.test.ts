import { describe, expect, it } from 'vitest';
import { flattenOnto, hasTransparency, parseBackground } from './background';

describe('parseBackground', () => {
  it.each([
    [undefined, [255, 255, 255]],
    ['', [255, 255, 255]],
    ['#fff', [255, 255, 255]],
    ['#000000', [0, 0, 0]],
    ['#FF8000', [255, 128, 0]],
    ['#f008', [255, 119, 119]], // half-transparent red mixed with white
    ['rgb(10, 20, 30)', [10, 20, 30]],
    ['rgb(10 20 30 / 50%)', [133, 138, 143]],
    ['rgba(0,0,0,0)', [255, 255, 255]],
    ['white', [255, 255, 255]],
    ['black', [0, 0, 0]],
    ['transparent', [255, 255, 255]],
    ['not a colour', [255, 255, 255]],
  ] as const)('%s → %j', (css, rgb) => {
    expect(parseBackground(css)).toEqual(rgb);
  });
});

describe('flattenOnto', () => {
  it('returns opaque images unchanged', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) };
    expect(hasTransparency(img)).toBe(false);
    expect(flattenOnto(img, [0, 0, 0])).toBe(img);
  });

  it('composites transparent and semi-transparent pixels over the colour', () => {
    const img = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([200, 100, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128]),
    };
    const out = flattenOnto(img, [255, 0, 0]);
    expect(Array.from(out.data)).toEqual([200, 100, 0, 255, 255, 0, 0, 255, 127, 0, 128, 255]);
  });
});
