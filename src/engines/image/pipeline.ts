// M4 image pipeline (P12): decode → size → resize → (pad) → encode → metadata → score, as one job
// inside the image worker. Every size comes from src/core/sizing (never stretched, never enlarged
// by default); every output is scored with SSIM against the pixels it was encoded from, and default
// and preset runs go through the quality guard (D24, D28).

import type {
  DecodedImage,
  ImageFormat,
  ImageJobInput,
  ImageJobResult,
  ImageMetadata,
  MetadataPolicy,
  OutputFormat,
} from '@/core/contracts/image';
import type { ExactOptions, Placement, Rect, ResizeOptions, Size } from '@/core/contracts/sizing';
import { exactPlacement, fitSize } from '@/core/sizing';
import type { Attempt } from '@/engines/optimize/attempt';
import { GUARD, guardQuality } from '@/engines/optimize/guard';
import { findQualityForTarget, sizeForTarget, TARGET_SEARCH } from '@/engines/optimize/target';
import { decodeImage } from './decode';
import {
  clampQuality,
  DEFAULT_QUALITY,
  encodeImage,
  ImageEncodeError,
  parseBackground,
} from './encode';
import { flattenOnto, hasTransparency } from './encode/background';
import { loadCodec } from './encode/codecs';
import { pngOptions } from './encode/options';
import { applyMetadataDetailed } from './metadata';
import { isGraphic, ssim } from './quality';
import type { Pixels } from './quality/pixels';
import { resizePixels } from './resize';

export type JobNote = ImageJobResult['notes'][number];

/**
 * The job input, plus two optional settings the shared contract doesn't have yet (they travel
 * through the queue as extra fields of the same object).
 */
export interface PipelineInput extends ImageJobInput {
  /**
   * Colour behind transparent pixels when saving as JPEG (IMG-01). Default: `exact.padColor`
   * when that is a colour, else white.
   */
  background?: string;
  /**
   * Quality guard (D28): true for default and preset runs, false when the user set the quality
   * themselves. When omitted it is on only if `quality` is the default (80). Never used with
   * `targetBytes` (the target search has its own floor).
   */
  qualityGuard?: boolean;
}

export interface PipelineResult extends ImageJobResult {
  /** Encodes made (1 unless the guard or the target search tried more qualities). */
  encodes: number;
  /** Set when the quality guard ran: extra encodes it made and whether it reached SSIM 0.97. */
  guard?: { steps: number; reached: boolean };
  /** With `target-unreachable`: estimated size (by the sizing rule) at which the target would fit. */
  suggestedSize?: Size;
  /** With `target-unreachable` for PNG: a lossy format that can reach the target. */
  suggestedFormat?: ImageFormat;
}

export type ProgressCallback = (progress: number) => void;

/** Progress milestones (decode 0–0.3, resize 0.3–0.5, encode 0.5–0.95, done 1). */
const PROGRESS = { decoded: 0.3, resized: 0.5, encoded: 0.95 } as const;

/** Extra oxipng levels tried when a PNG is over its target (level 2 is the normal encode). */
const PNG_TARGET_LEVELS = [4] as const;

const EXTENSIONS: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

type Rgba = readonly [number, number, number, number];
const TRANSPARENT: Rgba = [0, 0, 0, 0];

// ---------- the job ----------

/** Runs one image job. Throws user-readable errors (DecodeError, ImageEncodeError). */
export async function processImage(
  input: PipelineInput,
  onProgress?: ProgressCallback,
): Promise<PipelineResult> {
  const report = progressReporter(onProgress);
  const notes = new Set<JobNote>();
  report(0);

  // 1–2. Decode, size (sizing rule only), resize, place on the exact canvas. The full-size
  // decoded pixels are dropped when this returns; only the output-size pixels are kept.
  const { pixels, metadata, sourceFormat, graphic } = await decodeAndSize(input, notes, report);
  const size: Size = { width: pixels.width, height: pixels.height };

  // 3. Encode (with the guard or the target search), apply metadata, score.
  const chosen = chooseFormat(input.format, sourceFormat);
  if (chosen.fallback) notes.add('format-fallback');
  const quality = clampQuality(input.quality);
  const background = backgroundFor(input);
  const encoder = new AttemptEncoder(pixels, graphic, background, metadata, input.metadata);

  const targetBytes = validTarget(input.targetBytes);
  const guardOn = targetBytes === undefined && (input.qualityGuard ?? quality === DEFAULT_QUALITY);
  const budget =
    targetBytes !== undefined ? TARGET_SEARCH.maxEncodes : guardOn ? guardBudget(quality) : 1;
  // Never reaches the end of the encode span early (the guard's last-resort steps can exceed it).
  const encodeProgress = (done: number) =>
    report(
      PROGRESS.resized +
        ((PROGRESS.encoded - PROGRESS.resized) * Math.min(done, budget - 0.5)) / budget,
    );

  const { format, attempt: first } = await encoder.firstAttempt(chosen.format, quality, notes);
  encodeProgress(1);
  const extra: Pick<PipelineResult, 'guard' | 'suggestedSize' | 'suggestedFormat'> = {};
  let best: Attempt = first;

  if (targetBytes !== undefined && format === 'png') {
    const png = await encoder.pngForTarget(first, targetBytes);
    best = png;
    if (png.bytes > targetBytes) {
      notes.add('target-unreachable');
      extra.suggestedFormat = encoder.hasAlpha ? 'webp' : 'jpeg';
      extra.suggestedSize = sizeForTarget(size, png.bytes, targetBytes);
    }
  } else if (targetBytes !== undefined) {
    const target = await findQualityForTarget(encoder.memo(format, first), {
      targetBytes,
      maxQuality: quality,
      size,
      onEncode: (done) => encodeProgress(done),
    });
    best = target.best;
    if (!target.reached) notes.add('target-unreachable');
    if (target.suggestedSize) extra.suggestedSize = target.suggestedSize;
  } else if (guardOn && format !== 'png') {
    const guard = await guardQuality(first, encoder.memo(format, first), (step) =>
      encodeProgress(step),
    );
    best = guard.best;
    extra.guard = { steps: guard.steps, reached: guard.reached };
  }
  report(PROGRESS.encoded);

  if (encoder.jpegOnly(format)) notes.add('metadata-jpeg-only');
  const result: PipelineResult = {
    blob: best.blob,
    name: outputName(input.name, format),
    width: size.width,
    height: size.height,
    bytes: best.bytes,
    format,
    quality: best.quality,
    ssim: best.ssim,
    graphic,
    notes: [...notes],
    encodes: encoder.encodes,
    ...extra,
  };
  report(1);
  return result;
}

// ---------- decode and sizing ----------

interface Prepared {
  /** Output-size pixels, ready to encode. */
  pixels: ImageData;
  metadata: ImageMetadata;
  sourceFormat: DecodedImage['sourceFormat'];
  graphic: boolean;
}

async function decodeAndSize(
  input: PipelineInput,
  notes: Set<JobNote>,
  report: ProgressCallback,
): Promise<Prepared> {
  // Upright sRGB pixels. Huge images may come back smaller, never below what the output needs.
  let decoded = await decodeImage(input.file, decodeHint(input));
  if (decoded.reducedFrom && !reducedIsEnough(decoded, input)) {
    decoded = await decodeImage(input.file);
  }
  if (decoded.reducedFrom) notes.add('reduced-decode');
  // Judged on the source: what kind of picture it is, before resizing blends its edges.
  const graphic = isGraphic(decoded.pixels);
  report(PROGRESS.decoded);

  const pixels = await sizePixels(decoded, input, notes);
  report(PROGRESS.resized);
  return { pixels, metadata: decoded.metadata, sourceFormat: decoded.sourceFormat, graphic };
}

/** Works out the output size with the sizing rule and produces those pixels. */
async function sizePixels(
  decoded: DecodedImage,
  input: PipelineInput,
  notes: Set<JobNote>,
): Promise<ImageData> {
  const here: Size = { width: decoded.width, height: decoded.height };
  if (input.exact) {
    const placement = exactPlacement(here, input.exact);
    if (!input.exact.upscale && exactPlacement(here, { ...input.exact, upscale: true }).enlarged) {
      notes.add('not-enlarged');
    }
    if (placement.padded) notes.add('padded');
    if (placement.cropped) notes.add('cropped');
    return placePixels(decoded.pixels, placement, padColour(input.exact.padColor));
  }

  const resize = input.resize;
  if (!resize || resize.mode === 'none') return decoded.pixels;
  // Percentages and limits apply to the real image, even when it was decoded smaller.
  const original = decoded.reducedFrom ?? here;
  const out = fitSize(original, resize);
  if (!resize.upscale && fitSize(original, { ...resize, upscale: true }).enlarged) {
    notes.add('not-enlarged');
  }
  if (out.width === here.width && out.height === here.height) return decoded.pixels;
  return resizePixels(decoded.pixels, { width: out.width, height: out.height });
}

/**
 * The decode hint: the longest side the output can need, when it can be known before decoding
 * (`minLongestSide`; the decoder keeps at least 2× that). Uses the source size from intake when
 * given, trying both orientations since intake may not have applied EXIF rotation.
 */
export function decodeHint(input: ImageJobInput): { minLongestSide?: number } | undefined {
  try {
    const known = sourceSizes(input);
    if (input.exact) {
      const { width, height, fit } = input.exact;
      if (fit === 'fit') return hint(Math.max(width, height));
      if (!known) return undefined;
      return hint(Math.max(...known.map((s) => fillLongest(s, input.exact!))));
    }
    const resize = input.resize;
    if (!resize || resize.mode === 'none') return undefined;
    if (resize.mode === 'longest') return hint(resize.value);
    if (!known) return undefined;
    return hint(
      Math.max(
        ...known.map((s) => {
          const r = fitSize(s, resize);
          return Math.max(r.width, r.height);
        }),
      ),
    );
  } catch {
    return undefined; // bad settings: the sizing step will report them
  }
}

function hint(longest: number): { minLongestSide: number } | undefined {
  return Number.isFinite(longest) && longest > 0
    ? { minLongestSide: Math.ceil(longest) }
    : undefined;
}

function sourceSizes(input: ImageJobInput): Size[] | undefined {
  const { width, height } = input;
  if (!(typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0)) {
    return undefined;
  }
  return [
    { width, height },
    { width: height, height: width },
  ];
}

/** Longest side of the whole image scaled to cover the box (before the overflow is cropped). */
function fillLongest(src: Size, o: ExactOptions): number {
  const p = exactPlacement(src, o);
  const scale = Math.max(p.target.width / p.source.width, p.target.height / p.source.height);
  return Math.max(src.width, src.height) * scale;
}

/** A reduced decode must still be at least as big as what the output needs; otherwise decode in full. */
function reducedIsEnough(decoded: DecodedImage, input: ImageJobInput): boolean {
  const original = decoded.reducedFrom;
  if (!original) return true;
  const here: Size = { width: decoded.width, height: decoded.height };
  try {
    if (input.exact) {
      const want = exactPlacement(original, input.exact).target;
      const got = exactPlacement(here, input.exact).target;
      return got.width >= want.width - 1 && got.height >= want.height - 1;
    }
    if (input.resize && input.resize.mode !== 'none') {
      const want = fitSize(original, input.resize);
      return want.width <= here.width && want.height <= here.height;
    }
  } catch {
    return true; // bad settings are reported by the sizing step
  }
  return false; // no resize: the output is the full image
}

/**
 * Crops `placement.source`, resizes it to `placement.target` (Lanczos3) and draws it on a canvas of
 * exactly `placement.canvas`, filling the rest with `pad`. Plain array copies: no canvas, no
 * colour-space surprises, works in any worker.
 */
export async function placePixels(
  src: ImageData,
  placement: Placement,
  pad: Rgba,
): Promise<ImageData> {
  const { canvas, target } = placement;
  const crop = cropPixels(src, placement.source);
  const content =
    crop.width === target.width && crop.height === target.height
      ? crop
      : await resizePixels(crop, { width: target.width, height: target.height });
  if (
    target.x === 0 &&
    target.y === 0 &&
    target.width === canvas.width &&
    target.height === canvas.height
  ) {
    return content;
  }
  const out = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  fillPattern(out, pad);
  const rowBytes = target.width * 4;
  for (let y = 0; y < target.height; y++) {
    const from = y * rowBytes;
    out.set(
      content.data.subarray(from, from + rowBytes),
      ((target.y + y) * canvas.width + target.x) * 4,
    );
  }
  return new ImageData(out, canvas.width, canvas.height);
}

function cropPixels(src: ImageData, r: Rect): ImageData {
  if (r.x === 0 && r.y === 0 && r.width === src.width && r.height === src.height) return src;
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  const rowBytes = r.width * 4;
  for (let y = 0; y < r.height; y++) {
    const from = ((r.y + y) * src.width + r.x) * 4;
    out.set(src.data.subarray(from, from + rowBytes), y * rowBytes);
  }
  return new ImageData(out, r.width, r.height);
}

function fillPattern(out: Uint8ClampedArray, rgba: Rgba): void {
  if (out.length === 0) return;
  out.set(rgba, 0);
  let filled = 4;
  while (filled < out.length) {
    const n = Math.min(filled, out.length - filled);
    out.copyWithin(filled, 0, n);
    filled += n;
  }
}

/** Padding for exact Fit/Fill: 'transparent', a CSS colour, or white when not given. */
export function padColour(css: string | undefined): Rgba {
  if (css !== undefined && css.trim().toLowerCase() === 'transparent') return TRANSPARENT;
  const [r, g, b] = parseBackground(css);
  return [r, g, b, 255];
}

function backgroundFor(input: PipelineInput): string | undefined {
  if (input.background) return input.background;
  const pad = input.exact?.padColor;
  return pad && pad.trim().toLowerCase() !== 'transparent' ? pad : undefined;
}

// ---------- format ----------

const ENCODABLE: readonly ImageFormat[] = ['jpeg', 'png', 'webp', 'avif'];

/**
 * `keep` saves in the source format when it is JPEG, PNG, WebP or AVIF; anything else (HEIC, GIF,
 * BMP) becomes JPEG and is flagged `fallback`.
 */
export function chooseFormat(
  requested: OutputFormat,
  source: DecodedImage['sourceFormat'],
): { format: ImageFormat; fallback: boolean } {
  if (requested !== 'keep') return { format: requested, fallback: false };
  const kept = ENCODABLE.find((f) => f === source);
  return kept ? { format: kept, fallback: false } : { format: 'jpeg', fallback: true };
}

/** When a codec can't load (or can't take this size), the next format to try. Keeps transparency. */
function fallbackFormats(format: ImageFormat, alpha: boolean): ImageFormat[] {
  switch (format) {
    case 'avif':
      return alpha ? ['webp', 'png'] : ['webp', 'jpeg'];
    case 'webp':
      return alpha ? ['png'] : ['jpeg'];
    case 'jpeg':
      return ['png'];
    case 'png':
      return alpha ? ['webp'] : ['jpeg'];
  }
}

function canFallBack(error: unknown): boolean {
  return (
    error instanceof ImageEncodeError &&
    (error.code === 'codec-unavailable' || error.code === 'too-large')
  );
}

/** Original base name + the new extension ("IMG_1.HEIC" → "IMG_1.jpg"). */
export function outputName(name: string, format: ImageFormat): string {
  const base = name.replace(/\.[^./\\]*$/, '');
  return `${base || name || 'image'}.${EXTENSIONS[format]}`;
}

// ---------- encoding ----------

/** Encodes the prepared pixels, applies metadata and scores each result. Counts encodes. */
class AttemptEncoder {
  encodes = 0;
  readonly hasAlpha: boolean;
  private flat: ImageData | undefined;
  private readonly jpegOnlyByFormat = new Map<ImageFormat, boolean>();

  constructor(
    private readonly pixels: ImageData,
    private readonly graphic: boolean,
    private readonly background: string | undefined,
    private readonly metadata: ImageMetadata,
    private readonly policy: MetadataPolicy,
  ) {
    this.hasAlpha = hasTransparency(pixels);
  }

  /** JPEG has no alpha: encode and score the image flattened on the background colour. */
  private pixelsFor(format: ImageFormat): ImageData {
    if (format !== 'jpeg' || !this.hasAlpha) return this.pixels;
    this.flat ??= toImageData(flattenOnto(this.pixels, parseBackground(this.background)));
    return this.flat;
  }

  jpegOnly(format: ImageFormat): boolean {
    return this.jpegOnlyByFormat.get(format) ?? false;
  }

  async encode(format: ImageFormat, quality: number): Promise<Attempt> {
    const px = this.pixelsFor(format);
    this.encodes++;
    const encoded = await encodeImage(
      px,
      { format, quality, progressive: true, background: this.background },
      { graphic: this.graphic },
    );
    return this.finish(format, px, encoded, format === 'png' ? 100 : quality);
  }

  private async finish(
    format: ImageFormat,
    px: ImageData,
    encoded: Blob,
    quality: number,
  ): Promise<Attempt> {
    const score = ssim(px, await decodeForScore(encoded, px));
    const meta = await applyMetadataDetailed(encoded, this.metadata, this.policy);
    this.jpegOnlyByFormat.set(format, meta.jpegOnly);
    return { quality, blob: meta.blob, bytes: meta.blob.size, ssim: score };
  }

  /** The first encode, falling back to another format if the codec can't be used. */
  async firstAttempt(
    format: ImageFormat,
    quality: number,
    notes: Set<JobNote>,
  ): Promise<{ format: ImageFormat; attempt: Attempt }> {
    const order = [format, ...fallbackFormats(format, this.hasAlpha)];
    let lastError: unknown;
    for (const f of order) {
      try {
        const attempt = await this.encode(f, quality);
        if (f !== format) notes.add('format-fallback');
        return { format: f, attempt };
      } catch (error) {
        if (!canFallBack(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  /** `encodeAt` for the guard / target search, reusing the first result for its quality. */
  memo(format: ImageFormat, first: Attempt): (quality: number) => Promise<Attempt> {
    const known = new Map<number, Attempt>([[first.quality, first]]);
    return async (quality) => {
      const q = clampQuality(quality);
      const hit = known.get(q);
      if (hit) return hit;
      const a = await this.encode(format, q);
      known.set(q, a);
      return a;
    };
  }

  /** PNG over its target: try harder oxipng levels (lossless, so the score doesn't change). */
  async pngForTarget(first: Attempt, targetBytes: number): Promise<Attempt> {
    let best = first;
    if (best.bytes <= targetBytes) return best;
    const optimise = await loadCodec('png');
    for (const level of PNG_TARGET_LEVELS) {
      this.encodes++;
      const bytes = await optimise(this.pixels, { ...pngOptions, level });
      const blob = new Blob([bytes], { type: 'image/png' });
      if (blob.size < best.bytes) {
        const meta = await applyMetadataDetailed(blob, this.metadata, this.policy);
        best = { quality: 100, blob: meta.blob, bytes: meta.blob.size, ssim: first.ssim };
      }
      if (best.bytes <= targetBytes) break;
    }
    return best;
  }
}

function guardBudget(quality: number): number {
  return 1 + Math.max(0, Math.ceil((GUARD.maxQuality - quality) / GUARD.step));
}

function validTarget(bytes: number | undefined): number | undefined {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : undefined;
}

/** Decodes an encoded result back to pixels to score it (no EXIF or ICC in it yet). */
async function decodeForScore(blob: Blob, like: Size): Promise<ImageData> {
  let pixels: ImageData | undefined;
  try {
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
        pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' });
      }
      canvas.width = 0;
      canvas.height = 0;
    } finally {
      bitmap.close();
    }
  } catch {
    pixels = undefined;
  }
  // No browser decoder for this format (e.g. AVIF in an older browser): the engine's own decoder.
  pixels ??= (await decodeImage(blob)).pixels;
  if (pixels.width !== like.width || pixels.height !== like.height) {
    throw new RangeError('Encoded image came back at a different size');
  }
  return pixels;
}

function toImageData(p: Pixels): ImageData {
  if (p instanceof ImageData) return p;
  return new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);
}

function progressReporter(onProgress: ProgressCallback | undefined): ProgressCallback {
  let last = -1;
  return (p) => {
    const v = Math.min(1, Math.max(0, p));
    if (!onProgress || v <= last) return;
    last = v;
    try {
      // Through Comlink this returns a promise; a closed page must not fail the job.
      const r: unknown = onProgress(v);
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // ignore: progress is best effort
    }
  };
}

// ---------- input check (the worker receives this from another thread) ----------

const FORMATS: readonly OutputFormat[] = ['jpeg', 'png', 'webp', 'avif', 'keep'];
const POLICIES: readonly MetadataPolicy[] = ['strip-all', 'keep-all', 'strip-location'];

export function isPipelineInput(x: unknown): x is PipelineInput {
  if (typeof x !== 'object' || x === null) return false;
  const i = x as Record<string, unknown>;
  return (
    i.file instanceof Blob &&
    typeof i.name === 'string' &&
    FORMATS.includes(i.format as OutputFormat) &&
    typeof i.quality === 'number' &&
    POLICIES.includes(i.metadata as MetadataPolicy) &&
    optional(i.resize, isResize) &&
    optional(i.exact, isExact) &&
    optional(i.targetBytes, (v) => typeof v === 'number') &&
    optional(i.background, (v) => typeof v === 'string') &&
    optional(i.qualityGuard, (v) => typeof v === 'boolean')
  );
}

function optional(v: unknown, ok: (v: unknown) => boolean): boolean {
  return v === undefined || ok(v);
}

function isResize(v: unknown): v is ResizeOptions {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.mode === 'string' && typeof r.value === 'number';
}

function isExact(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.width === 'number' &&
    typeof e.height === 'number' &&
    typeof e.fit === 'string' &&
    optional(e.padColor, (c) => typeof c === 'string')
  );
}
