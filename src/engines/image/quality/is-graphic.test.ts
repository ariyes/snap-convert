import { describe, expect, it } from 'vitest';
import { graphicStats, isGraphic, isSoftEdgedArt } from './is-graphic';
import { logoArt, photoLike, photoScene, productOnWhite, skyGradient } from './testing/synthetic';

/**
 * A flat orange badge with a soft drop shadow (alpha easing off over 14 px, like the Gaussian
 * blur design tools use), a blue dot with a glow and an anti-aliased white bar, on white or on
 * transparency.
 */
function softShadowLogo(width: number, height: number, transparent: boolean) {
  const data = new Uint8ClampedArray(width * height * 4);
  const clamp = (t: number) => Math.min(1, Math.max(0, t));
  const smooth = (t: number) => clamp(t) ** 2 * (3 - 2 * clamp(t));
  const box = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
    Math.max(x0 - x, x - x1, y0 - y, y - y1, 0) - Math.min(x - x0, x1 - x, y - y0, y1 - y, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Layers bottom to top: [r, g, b, coverage].
      const badge = box(px, py, 60, 50, 220, 210);
      const dot = Math.hypot(px - 310, py - 90) - 40;
      const bar = box(px, py, 90, 120, 190, 140);
      const layers: Array<[number, number, number, number]> = [
        [0, 0, 0, 0.35 * smooth(1 - box(px, py - 6, 60, 50, 220, 210) / 14)], // shadow
        [37, 99, 235, 0.6 * smooth(1 - dot / 20)], // glow
        [194, 65, 12, clamp(0.5 - badge)],
        [37, 99, 235, clamp(0.5 - dot)],
        [255, 255, 255, clamp(0.5 - bar)],
      ];
      let [r, g, b, a] = transparent ? [0, 0, 0, 0] : [255, 255, 255, 1];
      for (const [lr, lg, lb, cover] of layers) {
        if (cover <= 0) continue;
        const outA = cover + a * (1 - cover);
        r = (lr * cover + r * a * (1 - cover)) / outA;
        g = (lg * cover + g * a * (1 - cover)) / outA;
        b = (lb * cover + b * a * (1 - cover)) / outA;
        a = outA;
      }
      data.set([r, g, b, Math.round(a * 255)], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

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

  // P24b F1: soft shadows and glows are smooth ramps, not grain.
  it.each([
    ['on white', false],
    ['transparent', true],
  ] as const)('flags a soft-shadow logo %s', (_, transparent) => {
    const img = softShadowLogo(400, 300, transparent);
    const s = graphicStats(img);
    expect(s.ramps, JSON.stringify(s)).toBeGreaterThan(0.02); // the shadow is really there
    expect(isGraphic(img), JSON.stringify(s)).toBe(true);
  });

  it('ignores colour hidden under fully transparent pixels (judged as seen)', () => {
    const img = softShadowLogo(400, 300, true);
    // Some exporters leave arbitrary colour under invisible pixels.
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) img.data.set([(i * 37) & 255, (i * 91) & 255, i & 255], i);
    }
    const s = graphicStats(img);
    expect(s.flat, 'raw values look busy').toBeLessThan(0.5);
    expect(isGraphic(img), JSON.stringify(s)).toBe(true);
  });

  it('a soft-shadow logo with grain added is a photo again', () => {
    const img = softShadowLogo(400, 300, false);
    let seed = 9;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const n = ((seed >>> 24) % 7) - 3;
      for (let c = 0; c < 3; c++) img.data[i + c] = img.data[i + c]! + n;
    }
    expect(isGraphic(img)).toBe(false);
  });

  it('a smooth gradient has ramps but no edges: not soft-edged art', () => {
    const s = graphicStats(skyGradient(400, 300));
    expect(s.edges).toBe(0);
    expect(isSoftEdgedArt(s)).toBe(false);
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
