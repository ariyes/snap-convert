// Test-only worker: times resizePixels inside a Web Worker. Used by resize.browser.test.ts.
import { resizePixels } from './index';

export interface ResizeJob {
  width: number;
  height: number;
  toWidth: number;
  toHeight: number;
  runs: number;
}
export interface ResizeReply {
  ok: boolean;
  /** Milliseconds per run, first run included (pica and its WebAssembly load on the first call). */
  timings: number[];
  width?: number;
  height?: number;
  error?: string;
}

/** A photo-like test pattern: gradients plus fine detail, so the work isn't trivially compressible. */
function pattern(width: number, height: number): ImageData {
  const img = new ImageData(width, height);
  const d = img.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      d[i] = (x * 255) / width;
      d[i + 1] = (y * 255) / height;
      d[i + 2] = ((x ^ y) & 1) * 255;
      d[i + 3] = 255;
    }
  }
  return img;
}

self.onmessage = async (event: MessageEvent<ResizeJob>) => {
  const job = event.data;
  try {
    const src = pattern(job.width, job.height);
    const timings: number[] = [];
    let out: ImageData | undefined;
    for (let r = 0; r < job.runs; r++) {
      const t0 = performance.now();
      out = await resizePixels(src, { width: job.toWidth, height: job.toHeight });
      timings.push(performance.now() - t0);
    }
    const reply: ResizeReply = { ok: true, timings, width: out?.width, height: out?.height };
    self.postMessage(reply);
  } catch (error: unknown) {
    const reply: ResizeReply = { ok: false, timings: [], error: String(error) };
    self.postMessage(reply);
  }
};
