// P12 acceptance criteria, through the real image worker (as the job queue runs it).
import * as Comlink from 'comlink';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUADRANT_COLOURS } from '../../../tests/fixtures/writers';
import {
  fixture,
  pixelsOf,
  runJob,
  startImageWorker,
  twelveMegapixelJpeg,
} from '../../../tests/quality/image-worker';
import type { PipelineInput } from './pipeline';
import { presetJob } from '@/engines/optimize';
import { colourDistance, corners, pixelAt } from './decode/test-utils';

const worker = startImageWorker();
afterAll(() => worker.stop());

const job = (file: Blob, patch: Partial<PipelineInput> = {}): PipelineInput => ({
  file,
  name: 'test.jpg',
  format: 'jpeg',
  quality: 80,
  metadata: 'strip-all',
  ...patch,
});

function expectUprightCard(img: ImageData): void {
  const c = corners(img);
  expect(colourDistance(c.topLeft, QUADRANT_COLOURS.topLeft)).toBeLessThan(40);
  expect(colourDistance(c.topRight, QUADRANT_COLOURS.topRight)).toBeLessThan(40);
  expect(colourDistance(c.bottomLeft, QUADRANT_COLOURS.bottomLeft)).toBeLessThan(40);
  expect(colourDistance(c.bottomRight, QUADRANT_COLOURS.bottomRight)).toBeLessThan(40);
}

describe('product rules', () => {
  it('resize keeps the aspect ratio (sizes from the sizing rule)', async () => {
    const product = await fixture('quality/photo-product-on-white.jpg'); // 1280×889
    const { result } = await runJob(
      worker,
      job(product, { resize: { mode: 'longest', value: 640 } }),
    );
    expect([result.width, result.height]).toEqual([640, 445]);
    const px = await pixelsOf(result.blob);
    expect([px.width, px.height]).toEqual([640, 445]);
    expect(result.notes).toEqual([]);
  });

  it('exact Fit: output is exactly the box, content keeps its ratio, padded with the colour', async () => {
    const product = await fixture('quality/photo-product-on-white.jpg'); // 1280×889
    const { result } = await runJob(
      worker,
      job(product, { exact: { width: 600, height: 600, fit: 'fit', padColor: '#ff0000' } }),
    );
    expect([result.width, result.height]).toEqual([600, 600]);
    expect(result.notes).toContain('padded');
    const px = await pixelsOf(result.blob);
    expect([px.width, px.height]).toEqual([600, 600]);
    // Content is 600×417 (1280/889 = 1.4398 ≈ 600/417), centred: red bands above and below.
    expect(colourDistance(pixelAt(px, 300, 20), [255, 0, 0])).toBeLessThan(30);
    expect(colourDistance(pixelAt(px, 300, 580), [255, 0, 0])).toBeLessThan(30);
    // The product photo's white background starts just inside the content area (row 91).
    expect(colourDistance(pixelAt(px, 20, 100), [255, 255, 255])).toBeLessThan(30);
  });

  it('exact Fill: output is exactly the box and the overflow is cropped, not squeezed', async () => {
    const product = await fixture('quality/photo-product-on-white.jpg');
    const { result } = await runJob(
      worker,
      job(product, { exact: { width: 500, height: 500, fit: 'fill' } }),
    );
    expect([result.width, result.height]).toEqual([500, 500]);
    expect(result.notes).toContain('cropped');
    expect(result.notes).not.toContain('padded');
  });

  it('never enlarges by default, and says so', async () => {
    const card = await fixture('images/orientation-1.jpg'); // 96×64
    const { result } = await runJob(
      worker,
      job(card, { resize: { mode: 'longest', value: 1920 } }),
    );
    expect([result.width, result.height]).toEqual([96, 64]);
    expect(result.notes).toContain('not-enlarged');
    const fit = await runJob(
      worker,
      job(card, { exact: { width: 300, height: 300, fit: 'fit', padColor: 'white' } }),
    );
    expect([fit.result.width, fit.result.height]).toEqual([300, 300]);
    expect(fit.result.notes).toEqual(expect.arrayContaining(['not-enlarged', 'padded']));
  });

  it('output is upright (EXIF orientation applied, written as 1 when kept)', async () => {
    for (const o of [3, 6, 8]) {
      const card = await fixture(`images/orientation-${o}.jpg`);
      for (const metadata of ['strip-all', 'keep-all'] as const) {
        const { result } = await runJob(worker, job(card, { metadata }));
        expect([result.width, result.height]).toEqual([96, 64]);
        expectUprightCard(await pixelsOf(result.blob));
      }
    }
  });
});

describe('transparency', () => {
  // alpha.png: transparent left third, 50% transparent blue middle, opaque orange right (90×60).
  it('PNG → JPEG gets the chosen background colour', async () => {
    const png = await fixture('images/alpha.png');
    const { result } = await runJob(worker, job(png, { background: '#00ff00' }));
    expect(result.format).toBe('jpeg');
    const px = await pixelsOf(result.blob);
    expect(colourDistance(pixelAt(px, 10, 30), [0, 255, 0])).toBeLessThan(12);
    expect(colourDistance(pixelAt(px, 45, 30), [0, 191, 128])).toBeLessThan(24);
    expect(colourDistance(pixelAt(px, 80, 30), [255, 64, 0])).toBeLessThan(24);
  });

  it('PNG → JPEG defaults to white; exact padColor doubles as the background', async () => {
    const png = await fixture('images/alpha.png');
    const white = await pixelsOf((await runJob(worker, job(png))).result.blob);
    expect(colourDistance(pixelAt(white, 10, 30), [255, 255, 255])).toBeLessThan(12);
    const padded = await runJob(
      worker,
      job(png, { exact: { width: 90, height: 60, fit: 'fit', padColor: '#000000' } }),
    );
    const black = await pixelsOf(padded.result.blob);
    expect(colourDistance(pixelAt(black, 10, 30), [0, 0, 0])).toBeLessThan(12);
  });

  it('PNG → WebP keeps alpha', async () => {
    const png = await fixture('images/alpha.png');
    const { result } = await runJob(worker, job(png, { format: 'webp', name: 'alpha.png' }));
    expect(result.format).toBe('webp');
    expect(result.name).toBe('alpha.webp');
    const px = await pixelsOf(result.blob);
    expect(pixelAt(px, 10, 30)[3]).toBeLessThan(10);
    expect(pixelAt(px, 45, 30)[3]).toBeGreaterThan(100);
    expect(pixelAt(px, 45, 30)[3]).toBeLessThan(155);
    expect(pixelAt(px, 80, 30)[3]).toBe(255);
  });

  it('exact Fit with transparent padding stays transparent in PNG', async () => {
    const card = await fixture('images/opaque.png'); // 90×60
    const { result } = await runJob(
      worker,
      job(card, {
        format: 'png',
        exact: { width: 90, height: 90, fit: 'fit', padColor: 'transparent' },
      }),
    );
    const px = await pixelsOf(result.blob);
    expect([px.width, px.height]).toEqual([90, 90]);
    expect(pixelAt(px, 45, 5)[3]).toBe(0);
    expect(pixelAt(px, 45, 45)[3]).toBe(255);
    expect(result.ssim).toBeGreaterThan(0.999); // lossless
  });
});

describe('graphics', () => {
  it('the text screenshot is a graphic; the product photo is not', async () => {
    const text = await runJob(worker, job(await fixture('quality/text-screenshot.png')));
    expect(text.result.graphic).toBe(true);
    const product = await runJob(worker, job(await fixture('quality/photo-product-on-white.jpg')));
    expect(product.result.graphic).toBe(false);
  });
});

describe('formats, metadata and notes', () => {
  it('keep: GIF becomes JPEG with a format-fallback note; PNG stays PNG', async () => {
    const gif = await runJob(
      worker,
      job(await fixture('images/sample.gif'), { format: 'keep', name: 'a.gif' }),
    );
    expect(gif.result).toMatchObject({ format: 'jpeg', name: 'a.jpg' });
    expect(gif.result.notes).toContain('format-fallback');
    const png = await runJob(worker, job(await fixture('images/opaque.png'), { format: 'keep' }));
    expect(png.result.format).toBe('png');
    expect(png.result.notes).not.toContain('format-fallback');
  });

  it('keep-all into WebP notes that details are kept only in JPEG', async () => {
    const r = await runJob(
      worker,
      job(await fixture('images/gps.jpg'), { format: 'webp', metadata: 'keep-all' }),
    );
    expect(r.result.notes).toContain('metadata-jpeg-only');
    const jpeg = await runJob(
      worker,
      job(await fixture('images/gps.jpg'), { metadata: 'keep-all' }),
    );
    expect(jpeg.result.notes).not.toContain('metadata-jpeg-only');
  });

  it('progress runs from 0 to 1, in order, through the pipeline stages', async () => {
    const { progress } = await runJob(
      worker,
      job(await fixture('quality/photo-product-on-white.jpg'), {
        resize: { mode: 'longest', value: 800 },
      }),
    );
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress).toEqual(expect.arrayContaining([0.3, 0.5, 0.95]));
  });

  it('broken input fails with a readable message; the worker keeps working', async () => {
    await expect(
      worker.api.run(
        'process',
        { nope: true },
        Comlink.proxy(() => undefined),
      ),
    ).rejects.toThrow("Snap Convert couldn't read the settings for this image.");
    await expect(
      worker.api.run(
        'explode',
        {},
        Comlink.proxy(() => undefined),
      ),
    ).rejects.toThrow('Unknown image operation "explode".');
    await expect(runJob(worker, job(new Blob([new Uint8Array([1, 2, 3, 4])])))).rejects.toThrow(
      "This file isn't an image Snap Convert can read",
    );
    const ok = await runJob(worker, job(await fixture('images/opaque.png')));
    expect(ok.result.width).toBe(90);
  });

  it('PNG target: harder oxipng first, then unreachable with a lossy-format suggestion', async () => {
    const text = await fixture('quality/text-screenshot.png');
    const fits = await runJob(worker, job(text, { format: 'png', targetBytes: 2_000_000 }));
    expect(fits.result.notes).not.toContain('target-unreachable');
    expect(fits.result.encodes).toBe(1);
    const over = await runJob(worker, job(text, { format: 'png', targetBytes: 20_000 }));
    expect(over.result.notes).toContain('target-unreachable');
    expect(over.result.encodes).toBe(2);
    expect(over.result.suggestedFormat).toBe('jpeg');
    expect(over.result.ssim).toBeGreaterThan(0.999); // still lossless
    const alpha = await runJob(
      worker,
      job(await fixture('images/alpha.png'), { format: 'png', targetBytes: 10 }),
    );
    expect(alpha.result.suggestedFormat).toBe('webp'); // keeps transparency
  }, 60_000);

  it('a user-chosen quality is never overridden by the guard', async () => {
    const night = await fixture('quality/photo-night-noise.jpg');
    const { result } = await runJob(
      worker,
      job(night, { quality: 70, resize: { mode: 'longest', value: 800 } }),
    );
    expect(result.quality).toBe(70);
    expect(result.guard).toBeUndefined();
    expect(result.encodes).toBe(1);
  });
});

describe('12 MP photo (4032×3024 JPEG)', () => {
  let big: Blob;
  beforeAll(async () => {
    big = await twelveMegapixelJpeg(worker);
    // Warm up: start the worker's codecs and pica on a small image.
    await runJob(worker, job(await fixture('images/orientation-1.jpg')));
  }, 120_000);

  it('web preset completes in under 3 s in the worker', async () => {
    const { result, ms } = await runJob(worker, presetJob('web', big, 'big.jpg'));
    expect([result.width, result.height]).toEqual([1920, 1440]);
    expect(result.ssim).toBeGreaterThanOrEqual(0.97);
    expect(ms, `${Math.round(ms)} ms`).toBeLessThan(3000);
  });

  it('target 200 KB at full size is unreachable: floor result plus a resize suggestion', async () => {
    const { result } = await runJob(worker, job(big, { targetBytes: 200_000 }));
    const detail = JSON.stringify({ ...result, blob: undefined });
    expect(result.notes, detail).toContain('target-unreachable');
    expect([result.width, result.height]).toEqual([4032, 3024]);
    expect(result.quality).toBeGreaterThanOrEqual(60);
    expect(result.ssim).toBeGreaterThanOrEqual(0.95); // not smeared
    expect(result.encodes).toBeLessThanOrEqual(7);
    const s = result.suggestedSize!;
    expect(s.width).toBeLessThan(4032);
    expect(Math.abs(s.width / s.height - 4 / 3)).toBeLessThan(0.01);
  }, 60_000);

  it('target 200 KB at 1600 px fits with SSIM ≥ 0.95', async () => {
    const { result } = await runJob(
      worker,
      job(big, { targetBytes: 200_000, resize: { mode: 'longest', value: 1600 } }),
    );
    const detail = JSON.stringify({ ...result, blob: undefined });
    expect(result.notes, detail).not.toContain('target-unreachable');
    expect([result.width, result.height]).toEqual([1600, 1200]);
    expect(result.bytes).toBeLessThanOrEqual(200_000);
    expect(result.ssim).toBeGreaterThanOrEqual(0.95);
    expect(result.quality).toBeGreaterThanOrEqual(60);
  }, 60_000);
});
