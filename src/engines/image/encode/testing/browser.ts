/** Helpers for P06 browser tests (main thread side). Not part of the app. */
import { wrap, type Remote } from 'comlink';
import type { Pixels } from '../../quality/pixels';
import type { HarnessApi } from './harness.worker';

export function startHarness(): { api: Remote<HarnessApi>; stop: () => void } {
  const worker = new Worker(new URL('./harness.worker.ts', import.meta.url), { type: 'module' });
  return { api: wrap<HarnessApi>(worker), stop: () => worker.terminate() };
}

export function toImageData(p: Pixels): ImageData {
  return new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);
}

/** Decodes with the browser's own decoder — what visitors will actually see. */
export async function decodeBlob(blob: Blob): Promise<ImageData> {
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

/** The browser's built-in JPEG encoder, `canvas.toBlob('image/jpeg', quality)`, for comparison. */
export async function browserJpeg(img: ImageData, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function bytesOf(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}
