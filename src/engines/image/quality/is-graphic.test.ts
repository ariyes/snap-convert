import { describe, expect, it } from 'vitest';
import { graphicStats, isGraphic } from './is-graphic';
import { logoArt, photoLike, photoScene, productOnWhite, skyGradient } from './testing/synthetic';

// Text screenshots need real canvas text, so they are checked in encode.browser.test.ts.
describe('isGraphic', () => {
  it.each([
    ['photo with fine detail', () => photoLike(400, 300, { seed: 1 })],
    ['landscape photo', () => photoScene(400, 300, { seed: 2 })],
    ['noisy night photo', () => photoScene(400, 300, { seed: 3, brightness: 45, grain: 2.5 })],
    ['product on white', () => productOnWhite(300, 300)],
    ['smooth sky gradient', () => skyGradient(400, 300)],
  ])('does not flag a %s', (_, make) => {
    expect(isGraphic(make())).toBe(false);
  });

  it.each([
    ['logo on white', () => logoArt(300, 300)],
    ['transparent logo', () => logoArt(300, 300, true)],
  ])('flags a %s', (_, make) => {
    expect(isGraphic(make())).toBe(true);
  });

  it('flags flat colour and two-colour art', () => {
    const flat = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(200) };
    expect(isGraphic(flat)).toBe(true);
    const stripes = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4) };
    for (let i = 0; i < stripes.data.length; i += 4) {
      const on = Math.floor(i / 4 / 7) % 2 === 0;
      stripes.data.set(on ? [20, 60, 200, 255] : [255, 255, 255, 255], i);
    }
    expect(isGraphic(stripes)).toBe(true);
  });

  it('samples big images instead of reading every pixel', () => {
    const s = graphicStats({
      width: 4000,
      height: 3000,
      data: new Uint8ClampedArray(4000 * 3000 * 4),
    });
    expect(s.samples).toBeLessThanOrEqual(1_100_000);
    expect(s.flat).toBe(1);
  });
});
