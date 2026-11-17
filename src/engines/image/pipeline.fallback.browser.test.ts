// P12b: whole image jobs give the same results without OffscreenCanvas in the worker (older
// Safari) as with it. Same worker code; one copy has the canvas switched off.
import { afterAll, describe, expect, it } from 'vitest';
import {
  fixture,
  pixelsOf,
  runJob,
  startImageWorker,
  type JobRun,
} from '../../../tests/quality/image-worker';
import type { ImageJobInput } from '@/core/contracts/image';
import { presetJob } from '@/engines/optimize';

const withCanvas = startImageWorker({ canvas: true });
const withoutCanvas = startImageWorker({ canvas: false });
afterAll(() => {
  withCanvas.stop();
  withoutCanvas.stop();
});

const job = (file: Blob, name: string, patch: Partial<ImageJobInput> = {}): ImageJobInput => ({
  file,
  name,
  format: 'jpeg',
  quality: 80,
  metadata: 'strip-all',
  ...patch,
});

async function bytesOf(run: JobRun): Promise<Uint8Array> {
  return new Uint8Array(await run.result.blob.arrayBuffer());
}

async function both(input: ImageJobInput): Promise<[JobRun, JobRun]> {
  return Promise.all([runJob(withCanvas, input), runJob(withoutCanvas, input)]);
}

describe('image jobs without OffscreenCanvas match the canvas path', () => {
  // Every source decodes to identical pixels without a canvas (fallback.browser.test.ts), so
  // these jobs must produce byte-identical files with identical scores.
  it.each<[string, string, Partial<ImageJobInput>]>([
    [
      'EXIF-rotated JPEG → WebP, resized',
      'images/orientation-6.jpg',
      { format: 'webp', resize: { mode: 'longest', value: 48 } },
    ],
    [
      'transparent PNG → JPEG on an hsl() background',
      'images/alpha.png',
      { format: 'jpeg', background: 'hsl(200 50% 50%)' },
    ],
    [
      'transparent PNG → PNG, exact Fit padded with a named colour',
      'images/alpha.png',
      { format: 'png', exact: { width: 120, height: 120, fit: 'fit', padColor: 'teal' } },
    ],
    ['GIF → keep (JPEG)', 'images/sample.gif', { format: 'keep' }],
    ['BMP → PNG', 'images/sample.bmp', { format: 'png' }],
    [
      'WebP → JPEG, exact Fill',
      'images/sample.webp',
      { exact: { width: 64, height: 64, fit: 'fill' } },
    ],
    [
      'portrait phone photo (EXIF 6) → JPEG with the guard',
      'quality/photo-portrait-exif-rotated.jpg',
      { qualityGuard: true, resize: { mode: 'longest', value: 1200 } },
    ],
    [
      'text screenshot PNG → WebP with the guard',
      'quality/text-screenshot.png',
      { format: 'webp', qualityGuard: true },
    ],
  ])(
    '%s',
    async (_label, path, patch) => {
      const file = await fixture(path);
      const [c, f] = await both(job(file, path, patch));
      expect(f.result.width).toBe(c.result.width);
      expect(f.result.height).toBe(c.result.height);
      expect(f.result.format).toBe(c.result.format);
      expect(f.result.notes).toEqual(c.result.notes);
      expect(f.result.quality).toBe(c.result.quality);
      expect(f.result.ssim).toBe(c.result.ssim);
      expect(await bytesOf(f)).toEqual(await bytesOf(c));
    },
    120_000,
  );

  it('web preset on the product photo: same file, same score', async () => {
    const file = await fixture('quality/photo-product-on-white.jpg');
    const [c, f] = await both(presetJob('web', file, 'product.jpg'));
    expect(f.result.ssim).toBe(c.result.ssim);
    expect(f.result.guard).toEqual(c.result.guard);
    expect(await bytesOf(f)).toEqual(await bytesOf(c));
  }, 120_000);

  it('transparent PNG → WebP (keeps alpha): same file, score within 0.001', async () => {
    // Scoring decodes the result again. A canvas hands back translucent pixels after a
    // premultiply round trip; the canvas-free WebP decoder returns them exactly.
    const file = await fixture('images/alpha.png');
    const [c, f] = await both(job(file, 'alpha.png', { format: 'webp' }));
    expect(await bytesOf(f)).toEqual(await bytesOf(c));
    expect(Math.abs(f.result.ssim - c.result.ssim)).toBeLessThan(0.001);
    const px = await pixelsOf(f.result.blob);
    expect(px.data[3]).toBe(0); // transparent left third kept
  });

  it('AVIF → JPEG (different AVIF decoders: scores within 0.002)', async () => {
    const file = await fixture('images/sample.avif');
    const [c, f] = await both(job(file, 'sample.avif'));
    expect([f.result.width, f.result.height]).toEqual([c.result.width, c.result.height]);
    expect(Math.abs(f.result.ssim - c.result.ssim)).toBeLessThan(0.002);
    expect(Math.abs(f.result.bytes - c.result.bytes) / c.result.bytes).toBeLessThan(0.05);
  });

  it('JPEG → AVIF: the result is scored with the canvas-free AVIF decoder', async () => {
    const file = await fixture('quality/photo-product-on-white.jpg');
    const input = job(file, 'product.jpg', {
      format: 'avif',
      resize: { mode: 'longest', value: 400 },
    });
    const [c, f] = await both(input);
    expect(f.result.format).toBe('avif');
    expect([f.result.width, f.result.height]).toEqual([c.result.width, c.result.height]);
    // Same encode; only the decoder that scores it differs (Chromium's vs libavif).
    expect(await bytesOf(f)).toEqual(await bytesOf(c));
    expect(Math.abs(f.result.ssim - c.result.ssim)).toBeLessThan(0.002);
    const px = await pixelsOf(f.result.blob);
    expect([px.width, px.height]).toEqual([f.result.width, f.result.height]);
  }, 120_000);
});
