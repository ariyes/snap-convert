/**
 * Test-only worker (P06): runs the real encoders and quality tools inside a Web Worker, the way
 * the image worker (P12) will. Browser tests talk to it through Comlink. Not part of the app.
 *
 * Heavy work (making 12 MP test pictures, decoding, scoring) also happens here, so the test page's
 * main thread stays free — other test files share it and have timing-sensitive tests.
 */
import { expose, transfer } from 'comlink';
import type { EncodeOptions, ImageMetadata, MetadataPolicy } from '@/core/contracts/image';
import { applyMetadataDetailed } from '../../metadata/apply';
import { isGraphic, ssim } from '../../quality';
import { makePicture, neighbourSteps, type PictureSpec } from '../../quality/testing/synthetic';
import { canUseThreads } from '../codecs';
import { encodeImage, type EncodeHints } from '../encode';

const pictures = new Map<string, ImageData>();

function picture(id: string): ImageData {
  const img = pictures.get(id);
  if (!img) throw new Error(`No test picture "${id}"`);
  return img;
}

async function decode(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

const api = {
  /** Makes a generated picture and keeps it in the worker under `id`. */
  make(id: string, spec: PictureSpec) {
    const p = makePicture(spec);
    pictures.set(id, new ImageData(p.data, p.width, p.height));
  },
  /** A copy of a stored picture, transferred (not cloned) to the page. */
  pixels(id: string) {
    const img = picture(id);
    const copy = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    return transfer(copy, [copy.data.buffer]);
  },
  forget(id: string) {
    pictures.delete(id);
  },
  async encode(id: string, o: EncodeOptions, hints?: EncodeHints) {
    const t0 = performance.now();
    const blob = await encodeImage(picture(id), o, hints);
    return { blob, ms: performance.now() - t0 };
  },
  /** Error name, code and message, for asserting typed errors across the worker boundary. */
  async encodeError(img: ImageData, o: EncodeOptions) {
    try {
      await encodeImage(img, o);
      return null;
    } catch (e) {
      const err = e as Error & { code?: string };
      return { name: err.name, code: err.code, message: err.message };
    }
  },
  /**
   * The browser's built-in JPEG encoder on picture `id` — OffscreenCanvas.convertToBlob, which is
   * the same encoder as canvas.toBlob (a test checks the bytes match) but keeps the page free.
   */
  async browserJpeg(id: string, quality: number) {
    const img = picture(id);
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  },
  /** Decodes `blob` with the browser's decoder and scores it against picture `id`. */
  async score(id: string, blob: Blob) {
    const decoded = await decode(blob);
    const t0 = performance.now();
    const score = ssim(picture(id), decoded);
    return { ssim: score, ssimMs: performance.now() - t0 };
  },
  /** Largest luma / RGB neighbour steps of the decoded `blob` (banding check). */
  async steps(blob: Blob) {
    return neighbourSteps(await decode(blob));
  },
  async decode(blob: Blob) {
    const img = await decode(blob);
    return transfer(img, [img.data.buffer]);
  },
  isGraphic(id: string) {
    const t0 = performance.now();
    const graphic = isGraphic(picture(id));
    return { graphic, ms: performance.now() - t0 };
  },
  applyMetadata(blob: Blob, meta: ImageMetadata, policy: MetadataPolicy) {
    return applyMetadataDetailed(blob, meta, policy);
  },
  environment() {
    return { threads: canUseThreads(), crossOriginIsolated: globalThis.crossOriginIsolated };
  },
};

export type HarnessApi = typeof api;

expose(api);
