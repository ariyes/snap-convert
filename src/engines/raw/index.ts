// M7 camera RAW (P29): details, the camera's own JPEG, and full develops of CR2, CR3, NEF, ARW,
// DNG, RAF, ORF, RW2, PEF, SRW and more. Loaded on demand by the image decoder (never in the
// startup bundle); the decoders themselves (FlashRaw, LibRaw fallback) run in a RAW worker of their
// own, started from here. See plan.ts for when the camera JPEG is used and when memory forces a
// half-size develop.

import type { DecodedImage, ImageMetadata, RawOptions } from '@/core/contracts/image';
import type { DecodeRaw, ExtractRawPreview, RawInfo, ReadRawInfo } from '@/core/contracts/raw';
import type { Size } from '@/core/contracts/sizing';
import { orientPixels, swapsAxes } from '@/engines/image/decode/orientation';
import { rawDevelop, rawInfo, rawPreview, RawWorkerError } from './client';
import { memoryBudget, normalizeRawOptions, planRaw } from './plan';
import type { DevelopRequest, DevelopResult, RawFileInfo } from './protocol';
import { rawStrings } from './strings';

export {
  DEFAULT_RAW_OPTIONS,
  memoryBudget,
  normalizeRawOptions,
  planRaw,
  RAW_MEMORY,
} from './plan';
export { closeRawWorker } from './client';

export type RawNote = 'raw-preview' | 'raw-half-size';
export type RawErrorCode = 'unsupported' | 'damaged' | 'too-large';

/** A RAW file that can't be turned into pixels, with a message that can be shown as is. */
export class RawDecodeError extends Error {
  constructor(
    readonly code: RawErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RawDecodeError';
  }
}

function toDecodeError(error: unknown): unknown {
  if (!(error instanceof RawWorkerError)) return error;
  const f = error.failure;
  switch (f.kind) {
    case 'unsupported':
      return new RawDecodeError(
        'unsupported',
        f.format ? rawStrings.unsupportedFormat(f.format) : rawStrings.unsupported,
      );
    case 'out-of-memory':
      return new RawDecodeError('too-large', rawStrings.tooLarge);
    default:
      return new RawDecodeError('damaged', rawStrings.damaged);
  }
}

async function plainErrors<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    throw toDecodeError(error);
  }
}

function isOutOfMemory(error: unknown): boolean {
  return error instanceof RawWorkerError && error.failure.kind === 'out-of-memory';
}

/** The contract's RawInfo (a copy without the worker's extras). */
function publicInfo(i: RawFileInfo): RawInfo {
  const info: RawInfo = {
    width: i.width,
    height: i.height,
    orientation: i.orientation,
    previews: i.previews.map((p) => ({ ...p })),
  };
  if (i.camera) info.camera = i.camera;
  return info;
}

/** Image details for the output (the metadata policy decides what is kept). */
export function rawMetadata(i: RawFileInfo): ImageMetadata {
  const meta: ImageMetadata = {
    orientation: i.orientation >= 1 && i.orientation <= 8 ? i.orientation : 1,
    hasLocation: i.hasLocation,
  };
  if (i.camera) meta.camera = i.camera;
  if (i.takenAt) meta.takenAt = i.takenAt;
  if (i.exif) meta.exif = i.exif;
  return meta;
}

/** Upright size of the developed image. */
function uprightSize(i: RawFileInfo): Size {
  return swapsAxes(i.orientation)
    ? { width: i.height, height: i.width }
    : { width: i.width, height: i.height };
}

function developed(i: RawFileInfo, r: DevelopResult, reducedFrom?: Size): DecodedImage {
  const pixels = new ImageData(new Uint8ClampedArray(r.pixels), r.width, r.height);
  const image: DecodedImage = {
    pixels,
    width: r.width,
    height: r.height,
    sourceFormat: 'raw',
    hasAlpha: false,
    metadata: rawMetadata(i),
  };
  if (reducedFrom) image.reducedFrom = reducedFrom;
  return image;
}

// ---------- contract (raw.ts) ----------

export const readRawInfo: ReadRawInfo = (file) =>
  plainErrors(async () => publicInfo(await rawInfo(file)));

export const extractRawPreview: ExtractRawPreview = (file) =>
  plainErrors(async () => {
    const p = await rawPreview(file);
    if (!p) return null;
    return {
      jpeg: new Blob([p.jpeg], { type: 'image/jpeg' }),
      width: p.width,
      height: p.height,
    };
  });

export const decodeRaw: DecodeRaw = (file, o) =>
  plainErrors(async () => {
    const options = normalizeRawOptions({ ...o, mode: 'full' });
    const result = await rawDevelop(file, {
      whiteBalance: options.whiteBalance,
      exposure: options.exposure,
      highlights: options.highlights,
      halfSize: o.halfSize,
    });
    return developed(result.info, result);
  });

// ---------- the image decoder's RAW branch ----------

export interface RawDecodeContext {
  /** From ImageJobInput.raw; defaults to fast mode, as shot, 0 EV, clip. */
  options?: Partial<RawOptions>;
  /** The pipeline's decode hint (the output's longest side, when known). */
  hint?: { minLongestSide?: number };
  /** Bytes this device can give a RAW decode (default: from the device; tests simulate phones). */
  budget?: number;
  /** Decodes the camera's JPEG with the image engine (applies the JPEG's own orientation). */
  decodeJpeg: (jpeg: Blob, hint?: { minLongestSide?: number }) => Promise<DecodedImage>;
  /** Tests: stands in for the RAW worker's develop (e.g. to simulate running out of memory). */
  develop?: (file: Blob, request: DevelopRequest) => Promise<DevelopResult>;
}

export interface RawDecodeResult {
  image: DecodedImage;
  notes: RawNote[];
}

/** The camera's JPEG as upright pixels with the RAW file's details, or undefined to develop instead. */
async function fromPreview(
  file: Blob,
  info: RawFileInfo,
  index: number,
  ctx: RawDecodeContext,
): Promise<DecodedImage | undefined> {
  const p = await rawPreview(file, index);
  if (!p) return undefined;
  let decoded: DecodedImage;
  try {
    decoded = await ctx.decodeJpeg(new Blob([p.jpeg], { type: 'image/jpeg' }), ctx.hint);
  } catch {
    return undefined; // a broken camera JPEG: develop the RAW data instead
  }
  // A JPEG with its own EXIF orientation was turned upright by the decoder; otherwise the RAW
  // file says how this preview is stored.
  let { pixels, reducedFrom } = decoded;
  if (decoded.metadata.orientation === 1 && p.orientation !== 1) {
    pixels = orientPixels(pixels, p.orientation);
    if (reducedFrom && swapsAxes(p.orientation)) {
      reducedFrom = { width: reducedFrom.height, height: reducedFrom.width };
    }
  }
  const image: DecodedImage = {
    pixels,
    width: pixels.width,
    height: pixels.height,
    sourceFormat: 'raw',
    hasAlpha: false,
    metadata: rawMetadata(info),
  };
  if (reducedFrom) image.reducedFrom = reducedFrom;
  return image;
}

/**
 * Decodes a RAW file for the image pipeline. Fast mode uses the camera's own full-size JPEG when
 * there is one (note `raw-preview`); otherwise the sensor data is developed, at half size when a
 * full develop won't fit this device's memory (note `raw-half-size`) or when the output is small
 * enough that half size loses nothing (a reduced decode, like big JPEGs get). Out of memory at full
 * size is retried once at half size. Throws {@link RawDecodeError}.
 */
export async function decodeRawImage(file: Blob, ctx: RawDecodeContext): Promise<RawDecodeResult> {
  const options = normalizeRawOptions(ctx.options);
  return plainErrors(async () => {
    const info = await rawInfo(file);
    const plan = planRaw({
      mode: options.mode,
      image: info,
      previews: info.embedded,
      fileBytes: file.size,
      budget: ctx.budget ?? memoryBudget(),
      minLongestSide: ctx.hint?.minLongestSide,
    });
    if (plan.use === 'preview') {
      const image = await fromPreview(file, info, plan.preview.index, ctx);
      if (image) return { image, notes: ['raw-preview'] };
    }
    let halfSize = plan.use === 'develop' && plan.halfSize;
    let forMemory = plan.use === 'develop' && plan.reason === 'memory';
    const request = (half: boolean): DevelopRequest => ({
      whiteBalance: options.whiteBalance,
      exposure: options.exposure,
      highlights: options.highlights,
      halfSize: half,
    });
    const develop = ctx.develop ?? rawDevelop;
    let result: DevelopResult;
    try {
      result = await develop(file, request(halfSize));
    } catch (error) {
      if (halfSize || !isOutOfMemory(error)) throw error;
      // Never let the tab crash: one more try at half size, in a fresh worker.
      halfSize = true;
      forMemory = true;
      result = await develop(file, request(true));
    }
    const reducedFrom = halfSize && !forMemory ? uprightSize(result.info) : undefined;
    const image = developed(result.info, result, reducedFrom);
    return { image, notes: forMemory ? ['raw-half-size'] : [] };
  });
}
