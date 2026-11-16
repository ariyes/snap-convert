// Test-only worker for resize.browser.test.ts. Heavy work (big resizes, reference filters and
// metrics written in plain JS) runs here, so the test page's main thread never blocks for long
// (other test files share it and measure timers).
import { fitSize } from '@/core/sizing';
import { decodeImage } from '../decode/index';
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

export type ResizeJob =
  | {
      kind: 'timing';
      width: number;
      height: number;
      toWidth: number;
      toHeight: number;
      runs: number;
    }
  | { kind: 'line-art'; file: Blob; ratio: number }
  | { kind: 'text'; file: Blob; ratio: number }
  | { kind: 'gradient'; file: Blob; ratio: number }
  | { kind: 'reference'; file: Blob; longestSide: number };

export interface TimingResult {
  /** Milliseconds per run, first run included (pica and its WebAssembly load on the first call). */
  timings: number[];
  width: number;
  height: number;
}
export interface LineArtResult {
  edge: number;
  edgeBilinear: number;
  /** Longest overshoot run (halo width) on rows / columns crossing the mid-grey square's edges. */
  haloRows: number[];
  haloColumns: number[];
  grating: number;
  gratingBilinear: number;
  zone: number;
  zoneNaive: number;
  /** Output is identical to Lanczos3 without sharpening. */
  equalsUnsharpened: boolean;
}
export interface TextResult {
  edge: number;
  edgeBilinear: number;
}
export interface GradientResult {
  sourceStep: number;
  step: number;
}
export interface ReferenceResult {
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
  edge: number;
  edgeBilinear: number;
}

type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

function scaled(img: ImageData, ratio: number) {
  const { width, height } = fitSize(img, { mode: 'percent', value: 100 / ratio });
  return { width, height };
}

/** Swaps rows and columns, so column profiles can be read as rows. */
function transposed(img: ImageData): ImageData {
  const out = new ImageData(img.height, img.width);
  const src = new Uint32Array(img.data.buffer);
  const dst = new Uint32Array(out.data.buffer);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) dst[x * img.height + y] = src[y * img.width + x] ?? 0;
  return out;
}

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

async function timing(job: Extract<ResizeJob, { kind: 'timing' }>): Promise<TimingResult> {
  const src = pattern(job.width, job.height);
  const timings: number[] = [];
  let out = src;
  for (let r = 0; r < job.runs; r++) {
    const t0 = performance.now();
    out = await resizePixels(src, { width: job.toWidth, height: job.toHeight });
    timings.push(performance.now() - t0);
  }
  return { timings, width: out.width, height: out.height };
}

// Line art layout (source pixels), see tests/fixtures/README.md:
// grey 96 panel x 1000–1600, y 760–1060 with a 176 square at x 1150–1450, y 830–990;
// 1 px grating x 1000–1400, y 1100–1300; zone plate centred at 1450,1650 with radius 300.
async function lineArt(file: Blob, ratio: number): Promise<LineArtResult> {
  const art = (await decodeImage(file)).pixels;
  const to = scaled(art, ratio);
  const out = await resizePixels(art, to);
  const bilinear = bilinearDownscale(art, to.width, to.height);
  const naive = naiveBilinear(art, to.width, to.height);
  const plain = await resizeWithSharpening(art, to, {
    unsharpAmount: 0,
    unsharpRadius: 0,
    unsharpThreshold: 0,
  });

  const haloRows = [870, 910, 950].map((y) =>
    longestOvershootRun(
      lumaRow(
        out,
        Math.round(y / ratio),
        Math.ceil(1000 / ratio) + 3,
        Math.floor(1600 / ratio) - 3,
      ),
      96,
      176,
      3,
    ),
  );
  const t = transposed(out);
  const haloColumns = [1225, 1300, 1375].map((x) =>
    longestOvershootRun(
      lumaRow(t, Math.round(x / ratio), Math.ceil(760 / ratio) + 3, Math.floor(1060 / ratio) - 3),
      96,
      176,
      3,
    ),
  );

  const inGrating = (x: number, y: number) =>
    x > 1000 / ratio + 3 && x < 1400 / ratio - 3 && y > 1100 / ratio + 3 && y < 1300 / ratio - 3;
  // Zone plate rings above 1.3× the output's Nyquist frequency must fade to grey.
  const fMin = Math.min(0.45, (1.3 * 0.5) / ratio);
  const R = 300 / ratio;
  const inZone = (x: number, y: number) => {
    const d = Math.hypot(x + 0.5 - 1450 / ratio, y + 0.5 - 1650 / ratio);
    return d > 2 * fMin * R && d < 0.95 * R;
  };

  return {
    edge: edgeContrast(out),
    edgeBilinear: edgeContrast(bilinear),
    haloRows,
    haloColumns,
    grating: lumaStdDev(out, inGrating),
    gratingBilinear: lumaStdDev(bilinear, inGrating),
    zone: lumaStdDev(out, inZone),
    zoneNaive: lumaStdDev(naive, inZone),
    equalsUnsharpened: out.data.every((v, i) => v === plain.data[i]),
  };
}

async function text(file: Blob, ratio: number): Promise<TextResult> {
  const img = (await decodeImage(file)).pixels;
  const to = scaled(img, ratio);
  return {
    edge: edgeContrast(await resizePixels(img, to)),
    edgeBilinear: edgeContrast(bilinearDownscale(img, to.width, to.height)),
  };
}

async function gradient(file: Blob, ratio: number): Promise<GradientResult> {
  const img = (await decodeImage(file)).pixels;
  return {
    sourceStep: maxNeighbourStep(img),
    step: maxNeighbourStep(await resizePixels(img, scaled(img, ratio))),
  };
}

async function reference(file: Blob, longestSide: number): Promise<ReferenceResult> {
  const img = (await decodeImage(file)).pixels;
  const to = fitSize(img, { mode: 'longest', value: longestSide });
  const out = await resizePixels(img, { width: to.width, height: to.height });
  return {
    width: img.width,
    height: img.height,
    outWidth: out.width,
    outHeight: out.height,
    edge: edgeContrast(out),
    edgeBilinear: edgeContrast(bilinearDownscale(img, to.width, to.height)),
  };
}

function run(job: ResizeJob): Promise<unknown> {
  switch (job.kind) {
    case 'timing':
      return timing(job);
    case 'line-art':
      return lineArt(job.file, job.ratio);
    case 'text':
      return text(job.file, job.ratio);
    case 'gradient':
      return gradient(job.file, job.ratio);
    case 'reference':
      return reference(job.file, job.longestSide);
  }
}

self.onmessage = async (event: MessageEvent<{ id: number; job: ResizeJob }>) => {
  const { id, job } = event.data;
  let reply: Reply;
  try {
    reply = { id, ok: true, result: await run(job) };
  } catch (error: unknown) {
    reply = { id, ok: false, error: String(error) };
  }
  self.postMessage(reply);
};
