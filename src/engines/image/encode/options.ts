/**
 * Codec settings for the image quality standard (decision D24). Pure functions, so the
 * choices are unit-tested without loading any WebAssembly.
 */
import type { EncodeOptions as AvifEncodeOptions } from '@jsquash/avif/meta.js';
import type { EncodeOptions as MozJpegEncodeOptions } from '@jsquash/jpeg/meta.js';
import type { OptimiseOptions } from '@jsquash/oxipng/meta.js';
import type { EncodeOptions as WebpEncodeOptions } from '@jsquash/webp/meta.js';

export type Chroma = '4:2:0' | '4:4:4';

export const DEFAULT_QUALITY = 80;

/** Whole number 1–100; anything unreadable becomes the default (80). */
export function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return DEFAULT_QUALITY;
  return Math.min(100, Math.max(1, Math.round(quality)));
}

/**
 * D24: 4:2:0 for photos; full-resolution colour (4:4:4) for text, logos, screenshots and sharp
 * coloured edges, and whenever quality is 90 or more.
 */
export function chooseChroma(quality: number, graphic: boolean): Chroma {
  return graphic || clampQuality(quality) >= 90 ? '4:4:4' : '4:2:0';
}

/** mozjpeg: trellis quantisation, optimised Huffman tables, progressive scans by default. */
export function jpegOptions(
  quality: number,
  chroma: Chroma,
  progressive = true,
): Partial<MozJpegEncodeOptions> {
  return {
    quality: clampQuality(quality),
    baseline: false,
    arithmetic: false, // not every viewer decodes arithmetic-coded JPEG
    progressive,
    optimize_coding: true,
    smoothing: 0,
    color_space: 3, // YCbCr
    // Standard JPEG (Annex K) tables. In our tests they keep more detail per byte (higher SSIM)
    // than mozjpeg's default ImageMagick-tuned table 3, which softens fine texture at the same
    // setting. Combined with trellis + progressive this is still ~20% smaller than libjpeg.
    quant_table: 0,
    // Trellis quantisation is always on in mozjpeg; these refine it further.
    trellis_multipass: true,
    trellis_opt_zero: true,
    trellis_opt_table: false,
    trellis_loops: 1,
    // Choose sampling ourselves (D24) rather than leaving it to the codec.
    auto_subsample: false,
    chroma_subsample: chroma === '4:4:4' ? 1 : 2,
    separate_chroma_quality: false,
    chroma_quality: clampQuality(quality),
  };
}

/**
 * libwebp's scale runs a little lower than JPEG's on detailed photos (WebP 80 scores below JPEG
 * 80 on SSIM). Lift the middle and top of the range by up to 5 so WebP never looks worse than a
 * JPEG at the same setting: 40 → 40, 60 → 62.5, 80 → 85, 95+ → 100.
 */
export function webpQuality(quality: number): number {
  const q = clampQuality(quality);
  const lift = 5 * Math.min(1, Math.max(0, (q - 40) / 40));
  return Math.min(100, Math.round(q + lift));
}

/**
 * libwebp lossy with sharp RGB→YUV conversion (clean coloured edges); keeps alpha.
 * Lossy WebP is always 4:2:0 — sharp YUV is what keeps coloured edges clean.
 */
export function webpOptions(quality: number): Partial<WebpEncodeOptions> {
  return {
    quality: webpQuality(quality),
    method: 4,
    use_sharp_yuv: 1,
    alpha_quality: 100,
    alpha_compression: 1,
    alpha_filtering: 1,
    exact: 0,
    lossless: 0,
  };
}

/**
 * Maps the app's 1–100 quality onto libavif's 0–100 scale so AVIF looks at least as good as
 * a JPEG at the same setting: 10 + 0.8 × quality (80 → 74, 50 → 50, 100 → 90).
 * Measured: at app 80, AVIF scores the same or higher SSIM than our JPEG at about 35–55% of its size.
 */
export function avifQuality(quality: number): number {
  return Math.round(10 + 0.8 * clampQuality(quality));
}

/**
 * libaom speed (0 slowest … 10 fastest), from the pixel count, so a 12 MP image finishes well
 * under 15 s on a desktop. Measured single-threaded on a 12 MP photo: speed 6 ≈ 6.5 s,
 * 7 ≈ 4.5 s, 8 ≈ 2.7 s. With threads (cross-origin isolated pages) it's faster still.
 */
export function avifSpeed(pixels: number, threaded: boolean): number {
  const mp = pixels / 1_000_000;
  if (mp <= (threaded ? 8 : 4)) return 6;
  if (mp <= 16) return 7;
  return 8;
}

export type AvifOptions = Partial<AvifEncodeOptions> & { bitDepth?: 8 };

export function avifOptions(
  quality: number,
  chroma: Chroma,
  pixels: number,
  threaded: boolean,
): AvifOptions {
  return {
    quality: avifQuality(quality),
    qualityAlpha: -1, // same as colour
    speed: avifSpeed(pixels, threaded),
    subsample: chroma === '4:4:4' ? 3 : 1, // libavif pixel format: 1 = 4:2:0, 3 = 4:4:4
    enableSharpYUV: chroma === '4:2:0',
    chromaDeltaQ: false,
    sharpness: 0,
    denoiseLevel: 0,
    tune: 0, // auto
    bitDepth: 8,
    lossless: false,
    tileColsLog2: 0,
    tileRowsLog2: 0,
  };
}

/** oxipng level 2, no interlacing; transparent pixels keep their colour (truly lossless). */
export const pngOptions: Partial<OptimiseOptions> = {
  level: 2,
  interlace: false,
  optimiseAlpha: false,
};

/** Largest side each codec accepts. */
export const MAX_SIDE = {
  jpeg: 65_535,
  png: 2 ** 31 - 1,
  webp: 16_383,
  avif: 65_536,
} as const;
