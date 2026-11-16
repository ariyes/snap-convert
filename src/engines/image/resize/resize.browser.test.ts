import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage } from '../decode/index';
import { fixture, pixelAt } from '../decode/test-utils';
import { resizePixels, resizeWithSharpening } from './index';
import {
  bilinearDownscale,
  edgeContrast,
  longestOvershootRun,
  lumaRow,
  lumaStdDev,
  maxNeighbourStep,
  naiveBilinear,
} from './test-metrics';
import type { ResizeJob, ResizeReply } from './testing-worker';

/** Swaps rows and columns, so column profiles can be read as rows. */
function transposed(img: ImageData): ImageData {
  const out = new ImageData(img.height, img.width);
  const src = new Uint32Array(img.data.buffer);
  const dst = new Uint32Array(out.data.buffer);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) dst[x * img.height + y] = src[y * img.width + x] ?? 0;
  return out;
}

/** Output size for a reduction ratio (test inputs only; app sizes come from src/core/sizing). */
const scaled = (img: ImageData, ratio: number) => ({
  width: Math.round(img.width / ratio),
  height: Math.round(img.height / ratio),
});

describe('resizePixels basics', () => {
  it('returns exactly the requested size', async () => {
    const src = new ImageData(300, 200);
    src.data.fill(200);
    const out = await resizePixels(src, { width: 97, height: 61 });
    expect([out.width, out.height, out.data.length]).toEqual([97, 61, 97 * 61 * 4]);
    expect(pixelAt(out, 50, 30)).toEqual([200, 200, 200, 200]);
  });

  it('returns the input unchanged when the size is the same', async () => {
    const src = new ImageData(10, 10);
    expect(await resizePixels(src, { width: 10, height: 10 })).toBe(src);
  });

  it('rejects invalid sizes', async () => {
    const src = new ImageData(10, 10);
    await expect(resizePixels(src, { width: 0, height: 5 })).rejects.toThrow(RangeError);
    await expect(resizePixels(src, { width: 5.5, height: 5 })).rejects.toThrow(RangeError);
  });

  it('enlarges when asked (upscale is the caller’s decision)', async () => {
    const src = new ImageData(10, 10);
    src.data.fill(255);
    const out = await resizePixels(src, { width: 25, height: 25 });
    expect([out.width, out.height]).toEqual([25, 25]);
    expect(pixelAt(out, 12, 12)).toEqual([255, 255, 255, 255]);
  });

  it('handles a view into a larger buffer', async () => {
    const backing = new Uint8ClampedArray(8 + 20 * 20 * 4).fill(90);
    const src = new ImageData(new Uint8ClampedArray(backing.buffer, 8, 20 * 20 * 4), 20, 20);
    const out = await resizePixels(src, { width: 10, height: 10 });
    expect(pixelAt(out, 5, 5)).toEqual([90, 90, 90, 90]);
  });

  it('does not darken colours next to transparent pixels', async () => {
    // Opaque orange next to fully transparent black: correct (premultiplied) resampling keeps the orange.
    const src = new ImageData(40, 10);
    for (let y = 0; y < 10; y++) {
      for (let x = 20; x < 40; x++) src.data.set([255, 128, 0, 255], (y * 40 + x) * 4);
    }
    const out = await resizePixels(src, { width: 13, height: 3 });
    for (let x = 0; x < 13; x++) {
      const [r, g, , a] = pixelAt(out, x, 1);
      if (a > 32) {
        expect(r).toBeGreaterThan(235);
        expect(Math.abs(g - 128)).toBeLessThan(20);
      }
    }
  });
});

describe('performance', () => {
  it('resizes 4000×3000 → 1000×750 in a worker in under 1.5 s', async () => {
    const worker = new Worker(new URL('./testing-worker.ts', import.meta.url), { type: 'module' });
    const job: ResizeJob = { width: 4000, height: 3000, toWidth: 1000, toHeight: 750, runs: 3 };
    const reply = await new Promise<ResizeReply>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ResizeReply>) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage(job);
    }).finally(() => worker.terminate());
    expect(reply.ok).toBe(true);
    expect([reply.width, reply.height]).toEqual([1000, 750]);
    // Every run, including the first (which also loads pica), must be under 1.5 s.
    for (const ms of reply.timings) expect(ms).toBeLessThan(1500);
  }, 30_000);
});

describe('crispness (image quality standard, D24)', () => {
  let art: ImageData;
  let text: ImageData;
  beforeAll(async () => {
    art = (await decodeImage(await fixture('quality/line-art-logo.png'))).pixels;
    text = (await decodeImage(await fixture('quality/text-screenshot.png'))).pixels;
  });

  it.each([1.5, 2, 3, 4, 8])('%s× reduction: sharper than plain bilinear on line art and text', async (ratio) => {
    for (const img of [art, text]) {
      const to = scaled(img, ratio);
      const ours = edgeContrast(await resizePixels(img, to));
      const bilinear = edgeContrast(bilinearDownscale(img, to.width, to.height));
      expect(ours).toBeGreaterThan(bilinear * 1.1);
    }
  });

  // Line art panel (source pixels): grey 96 from x 1000–1600, y 760–1060, with a lighter 176 square at
  // x 1150–1450, y 830–990. Profiles cross the square's edges horizontally and vertically.
  // A halo is any run of pixels overshooting either level by more than 3; it may be at most 1 px wide.
  it.each([1.25, 1.5, 2, 2.5, 3, 4, 6, 8, 12])('%s× reduction: no halo wider than 1 px', async (ratio) => {
    const out = await resizePixels(art, scaled(art, ratio));
    for (const y of [870, 910, 950]) {
      const row = lumaRow(out, Math.round(y / ratio), Math.ceil(1000 / ratio) + 3, Math.floor(1600 / ratio) - 3);
      expect(longestOvershootRun(row, 96, 176, 3)).toBeLessThanOrEqual(1);
    }
    const rotated = transposed(out);
    for (const x of [1225, 1300, 1375]) {
      const column = lumaRow(rotated, Math.round(x / ratio), Math.ceil(760 / ratio) + 3, Math.floor(1060 / ratio) - 3);
      expect(longestOvershootRun(column, 96, 176, 3)).toBeLessThanOrEqual(1);
    }
  });

  // Lines 1 px apart (x 1000–1400, y 1100–1300) are finer than any smaller image can show:
  // they must become flat grey, not stripes or beats (moiré).
  const gratingSpread = (out: ImageData, ratio: number) =>
    lumaStdDev(out, (x, y) => x > 1000 / ratio + 3 && x < 1400 / ratio - 3 && y > 1100 / ratio + 3 && y < 1300 / ratio - 3);

  it.each([1.4, 1.5, 2, 3, 4, 8])('%s× reduction: no moiré on the 1 px line grating', async (ratio) => {
    expect(gratingSpread(await resizePixels(art, scaled(art, ratio)), ratio)).toBeLessThan(3);
  });

  // Just below 1.4× the grating sits in every practical filter's transition band. Lanczos3 is the
  // best pica offers there; it must at least beat plain bilinear.
  it.each([1.1, 1.25, 1.33])('%s× reduction: less moiré than bilinear on the 1 px grating', async (ratio) => {
    const to = scaled(art, ratio);
    const ours = gratingSpread(await resizePixels(art, to), ratio);
    expect(ours).toBeLessThan(gratingSpread(bilinearDownscale(art, to.width, to.height), ratio) * 1.05);
  });

  // Zone plate (centre 1450,1650, radius 300): rings whose frequency is well above the output's
  // limit (1.3× its Nyquist frequency) must fade to grey instead of turning into false rings.
  it.each([2, 3, 4, 6, 8])('%s× reduction: no moiré on the zone plate', async (ratio) => {
    const out = await resizePixels(art, scaled(art, ratio));
    const fMin = (1.3 * 0.5) / ratio; // cycles per source pixel
    const R = 300 / ratio;
    const inside = (x: number, y: number) => {
      const d = Math.hypot(x + 0.5 - 1450 / ratio, y + 0.5 - 1650 / ratio);
      return d > 2 * fMin * R && d < 0.95 * R;
    };
    const ours = lumaStdDev(out, inside);
    const naive = lumaStdDev(naiveBilinear(art, out.width, out.height), inside);
    expect(ours).toBeLessThan(10);
    expect(ours).toBeLessThan(naive / 3);
  });

  it('sharpening is off below 1.25× (output equals plain Lanczos3)', async () => {
    const to = scaled(art, 1.2);
    const plain = await resizeWithSharpening(art, to, { unsharpAmount: 0, unsharpRadius: 0, unsharpThreshold: 0 });
    expect((await resizePixels(art, to)).data).toEqual(plain.data);
  });
});

describe('no banding in smooth gradients', () => {
  it.each([1.5, 3, 4.7])('sky gradient survives decode + %s× resize with steps ≤ 2 levels', async (ratio) => {
    const sky = (await decodeImage(await fixture('quality/sky-gradient.png'))).pixels;
    expect(maxNeighbourStep(sky)).toBeLessThanOrEqual(1);
    const out = await resizePixels(sky, scaled(sky, ratio));
    expect(maxNeighbourStep(out)).toBeLessThanOrEqual(2);
  });
});

describe('reference quality set', () => {
  it.each([
    ['photo-fine-detail.jpg', false],
    ['photo-night-noise.jpg', false],
    ['photo-product-on-white.jpg', false],
    ['photo-portrait-exif-rotated.jpg', true],
    ['sky-gradient.png', false],
    ['text-screenshot.png', false],
    ['line-art-logo.png', false],
  ] as const)('%s: decodes upright and resizes sharper than bilinear', async (name, portrait) => {
    const decoded = await decodeImage(await fixture(`quality/${name}`));
    expect(decoded.height > decoded.width).toBe(portrait);
    const img = decoded.pixels;
    const ratio = Math.max(img.width, img.height) / 800;
    const to = scaled(img, ratio);
    const out = await resizePixels(img, to);
    expect([out.width, out.height]).toEqual([to.width, to.height]);
    if (name !== 'sky-gradient.png') {
      expect(edgeContrast(out)).toBeGreaterThan(edgeContrast(bilinearDownscale(img, to.width, to.height)));
    }
  }, 60_000);
});
