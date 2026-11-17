// Test helpers (page side) for running jobs through the real image worker, as the job queue does.
// Used by the quality report and src/engines/image/pipeline.browser.test.ts. Not app code.
import * as Comlink from 'comlink';
import { commands } from 'vitest/browser';
import type { WorkerApi } from '@/core/contracts';
import type { ImageJobInput, ImageJobResult } from '@/core/contracts/image';

export interface ImageWorker {
  api: Comlink.Remote<WorkerApi>;
  stop: () => void;
}

/**
 * VITE_IMAGE_NO_CANVAS=1 runs every job as older Safari would: the same image worker with
 * OffscreenCanvas switched off, so the engine uses its canvas-free decoders (P12b).
 */
export const noCanvasMode = import.meta.env.VITE_IMAGE_NO_CANVAS === '1';

/**
 * Starts the app's image worker (the same file the queue's registry loads). `canvas: false` (or
 * VITE_IMAGE_NO_CANVAS=1) starts it with OffscreenCanvas switched off.
 */
export function startImageWorker(options: { canvas?: boolean } = {}): ImageWorker {
  const canvas = options.canvas ?? !noCanvasMode;
  // Literal `new Worker(new URL(…))` in each branch, so Vite bundles both as workers.
  const worker = canvas
    ? new Worker(new URL('../../src/engines/image/worker.ts', import.meta.url), {
        type: 'module',
      })
    : new Worker(new URL('../../src/engines/image/testing/no-canvas-worker.ts', import.meta.url), {
        type: 'module',
      });
  return { api: Comlink.wrap<WorkerApi>(worker), stop: () => worker.terminate() };
}

export interface JobRun {
  result: ImageJobResult;
  progress: number[];
  ms: number;
}

/** Runs one `process` job; also returns every progress value and how long it took. */
export async function runJob(worker: ImageWorker, input: ImageJobInput): Promise<JobRun> {
  const progress: number[] = [];
  const start = performance.now();
  const result = (await worker.api.run(
    'process',
    input,
    Comlink.proxy((p: number) => {
      progress.push(p);
    }),
  )) as ImageJobResult;
  const ms = performance.now() - start;
  // Progress calls travel on their own message channel and can land just after the result.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { result, progress, ms };
}

/** Reads a file under tests/fixtures/ (through Vitest's file commands, not the network). */
export async function fixture(path: string): Promise<Blob> {
  const base64 = await commands.readFile(`tests/fixtures/${path}`, 'base64');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

/** Decodes a (small) result on the page to check its pixels. */
export async function pixelsOf(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * A real 12 MP phone photo as JPEG: the iPhone 7 HEIC fixture (4032×3024) converted to JPEG at
 * quality 92 by the image worker itself (libheif runs in the worker, not on the test page).
 */
export async function twelveMegapixelJpeg(worker: ImageWorker): Promise<Blob> {
  const { result } = await runJob(worker, {
    file: await fixture('images/iphone-7.heic'),
    name: 'iphone-7.heic',
    format: 'jpeg',
    quality: 92,
    metadata: 'strip-all',
    qualityGuard: false,
  });
  if (result.width * result.height < 12_000_000) throw new Error('expected a 12 MP image');
  return result.blob;
}
