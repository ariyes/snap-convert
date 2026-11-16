/** Helpers for P06 browser tests (page side). Not part of the app. */
import { wrap, type Remote } from 'comlink';
import type { HarnessApi } from './harness.worker';

export function startHarness(): { api: Remote<HarnessApi>; stop: () => void } {
  const worker = new Worker(new URL('./harness.worker.ts', import.meta.url), { type: 'module' });
  return { api: wrap<HarnessApi>(worker), stop: () => worker.terminate() };
}

/**
 * The browser's built-in JPEG encoder, `canvas.toBlob('image/jpeg', quality)`, for comparison.
 * Needs a real <canvas>, so it runs on the page; the browser encodes off the main thread.
 */
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
