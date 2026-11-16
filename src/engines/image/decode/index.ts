// M4 image decode (P05): any supported file → upright sRGB pixels + metadata.
// Runs inside a Web Worker: only createImageBitmap, OffscreenCanvas and WebAssembly, no DOM.

import type { DecodeImage, DecodedImage } from '@/core/contracts/image';
import type { Size } from '@/core/contracts/sizing';
import { applyColorTransform, iccToSrgb, nclxToSrgb } from './color';
import { readContainer, type ContainerInfo, type SniffedFormat } from './container';
import { readMetadata } from './metadata';
import { applyIsoTransforms, browserAppliesOrientation, orientPixels, swapsAxes } from './orientation';
import { decodeStrings } from './strings';

export type DecodeErrorCode = 'unsupported' | 'heic-unsupported' | 'too-large';

/** A decode failure with a message that can be shown to the user as is. */
export class DecodeError extends Error {
  readonly code: DecodeErrorCode;
  constructor(code: DecodeErrorCode, message: string) {
    super(message);
    this.name = 'DecodeError';
    this.code = code;
  }
}

export interface DecodeLimits {
  /** Refuse anything bigger (16384 × 16384, the largest canvas browsers allow). */
  maxPixels: number;
  /** Above this, decode at reduced size when the caller says how big the output will be. */
  reduceAbovePixels: number;
}

export const DECODE_LIMITS: DecodeLimits = { maxPixels: 16384 * 16384, reduceAbovePixels: 50_000_000 };

export interface DecodeOptions {
  limits?: DecodeLimits;
  /** 'wasm' skips the browser's AVIF decoder and uses the WebAssembly fallback (for tests). */
  avifDecoder?: 'auto' | 'wasm';
}

interface Hint {
  minLongestSide?: number;
}

/** Reduced decodes keep at least this multiple of the final size, so the last Lanczos step still has detail. */
const REDUCED_DECODE_FACTOR = 2;

/** Decodes a JPEG, PNG, WebP, AVIF, GIF (first frame), BMP or HEIC/HEIF file. Throws {@link DecodeError}. */
export const decodeImage: DecodeImage = (file, hint) => decodeImageWith(file, hint);

export async function decodeImageWith(file: Blob, hint?: Hint, options: DecodeOptions = {}): Promise<DecodedImage> {
  const limits = options.limits ?? DECODE_LIMITS;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = await readContainer(bytes);
  if (info.format === 'unknown') throw new DecodeError('unsupported', decodeStrings.unsupported);
  if (info.width && info.height) checkPixels(info.width * info.height, limits);

  const metadata = await readMetadata(info);
  // HEIF and AVIF carry rotation in the container (irot/imir), which their decoders apply.
  // Their EXIF orientation only repeats it and must not be applied a second time.
  const orientation = usesExifOrientation(info.format) ? metadata.orientation : 1;

  let decoded: { pixels: ImageData; reducedFrom?: Size } | undefined;
  if (!(info.format === 'avif' && options.avifDecoder === 'wasm')) {
    decoded = await decodeWithBrowser(file, info, orientation, hint, limits);
  }
  if (!decoded) {
    const pixels = await decodeWithWasm(bytes, info);
    checkPixels(pixels.width * pixels.height, limits);
    decoded = { pixels };
  }

  const { pixels, reducedFrom } = decoded;
  const result: DecodedImage = {
    pixels,
    width: pixels.width,
    height: pixels.height,
    sourceFormat: info.format,
    hasAlpha: canHaveAlpha(info.format) && hasTransparency(pixels),
    metadata,
  };
  if (reducedFrom) result.reducedFrom = reducedFrom;
  return result;
}

function usesExifOrientation(format: SniffedFormat): format is 'jpeg' | 'png' | 'webp' {
  return format === 'jpeg' || format === 'png' || format === 'webp';
}

function canHaveAlpha(format: SniffedFormat): boolean {
  return format !== 'jpeg';
}

function checkPixels(pixels: number, limits: DecodeLimits): void {
  if (pixels > limits.maxPixels) {
    throw new DecodeError('too-large', decodeStrings.tooLarge(Math.round(pixels / 1_000_000)));
  }
}

/** True if any pixel is not fully opaque. Stops at the first one (JPEGs are never scanned). */
export function hasTransparency(img: ImageData): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) return true;
  }
  return false;
}

// ---------- Browser decode (createImageBitmap) ----------

async function predictBrowserOrientation(format: 'jpeg' | 'png' | 'webp'): Promise<boolean> {
  const forFormat = await browserAppliesOrientation(format);
  if (forFormat !== undefined) return forFormat;
  // The test couldn't run for this format (e.g. no WebP encoder in Safari): assume it behaves like JPEG.
  return (await browserAppliesOrientation('jpeg')) ?? true;
}

async function decodeWithBrowser(
  file: Blob,
  info: ContainerInfo,
  orientation: number,
  hint: Hint | undefined,
  limits: DecodeLimits,
): Promise<{ pixels: ImageData; reducedFrom?: Size } | undefined> {
  const exifFormat = usesExifOrientation(info.format) ? info.format : undefined;
  const rotates = orientation !== 1 && exifFormat !== undefined ? await predictBrowserOrientation(exifFormat) : false;
  let reduce = exifFormat || info.format === 'gif' || info.format === 'bmp'
    ? reducedSize(info, orientation, rotates, hint, limits)
    : undefined;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, bitmapOptions(reduce));
  } catch {
    return undefined;
  }
  if (reduce && (bitmap.width !== reduce.width || bitmap.height !== reduce.height)) {
    // The browser sized it differently than asked (resizing before rotating, or no resize support):
    // decode again at full size rather than risk a stretched image.
    bitmap.close();
    reduce = undefined;
    try {
      bitmap = await createImageBitmap(file, bitmapOptions(undefined));
    } catch {
      return undefined;
    }
  }

  let applied = rotates;
  const { width: sw, height: sh } = info;
  if (!reduce && orientation !== 1 && swapsAxes(orientation) && sw && sh && sw !== sh) {
    // Exact check for this very image: did the bitmap come back with width and height swapped?
    applied = bitmap.width === sh && bitmap.height === sw;
  }

  let pixels: ImageData;
  try {
    checkPixels(bitmap.width * bitmap.height, limits);
    pixels = bitmapPixels(bitmap);
  } finally {
    bitmap.close();
  }
  if (orientation !== 1 && !applied) pixels = orientPixels(pixels, orientation);

  if (!reduce || !sw || !sh) return { pixels };
  const reducedFrom = swapsAxes(orientation) ? { width: sh, height: sw } : { width: sw, height: sh };
  return { pixels, reducedFrom };
}

function bitmapOptions(resize: Size | undefined): ImageBitmapOptions {
  const options: ImageBitmapOptions = { imageOrientation: 'from-image' };
  if (resize) {
    options.resizeWidth = resize.width;
    options.resizeHeight = resize.height;
    options.resizeQuality = 'high';
  }
  return options;
}

/**
 * For a huge image with a known final size: the size (in the bitmap's own orientation) to decode at.
 * At least {@link REDUCED_DECODE_FACTOR}× the final longest side, never below it, and only ever smaller
 * than the original. Same aspect ratio as the original (this is an intermediate, not an output size).
 */
function reducedSize(
  info: ContainerInfo,
  orientation: number,
  browserRotates: boolean,
  hint: Hint | undefined,
  limits: DecodeLimits,
): Size | undefined {
  const minLongest = hint?.minLongestSide;
  const { width: sw, height: sh } = info;
  if (!minLongest || !(minLongest > 0) || !sw || !sh || sw * sh <= limits.reduceAbovePixels) return undefined;
  const longest = Math.max(sw, sh);
  const target = Math.ceil(minLongest * REDUCED_DECODE_FACTOR);
  if (target >= longest) return undefined;
  const scale = target / longest;
  const [bw, bh] = browserRotates && swapsAxes(orientation) ? [sh, sw] : [sw, sh];
  const size = { width: Math.max(1, Math.round(bw * scale)), height: Math.max(1, Math.round(bh * scale)) };
  // Rounding must not take the longest side below the hint.
  return Math.max(size.width, size.height) >= minLongest ? size : undefined;
}

function bitmapPixels(bitmap: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' });
  } catch {
    // The browser couldn't allocate a canvas this big (common on phones).
    throw new DecodeError('too-large', decodeStrings.tooLarge(Math.round((bitmap.width * bitmap.height) / 1_000_000)));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

// ---------- WebAssembly decode (HEIC everywhere but Safari; AVIF in browsers without AVIF) ----------

async function decodeWithWasm(bytes: Uint8Array, info: ContainerInfo): Promise<ImageData> {
  let pixels: ImageData | undefined;
  if (info.format === 'heic') {
    const { decodeHeic } = await import('./heic');
    try {
      pixels = await decodeHeic(bytes);
    } catch {
      pixels = undefined;
    }
    if (!pixels) throw new DecodeError('heic-unsupported', decodeStrings.heicUnsupported);
  } else if (info.format === 'avif') {
    const { decodeAvif } = await import('./avif');
    try {
      pixels = await decodeAvif(bytes);
    } catch {
      pixels = undefined;
    }
    if (!pixels) throw new DecodeError('unsupported', decodeStrings.unsupported);
    pixels = applyIsoTransforms(pixels, info.transforms);
  } else {
    throw new DecodeError('unsupported', decodeStrings.unsupported);
  }
  // WebAssembly decoders return the file's own RGB values; convert them to sRGB.
  const transform = info.icc ? iccToSrgb(info.icc) : info.nclx ? nclxToSrgb(info.nclx) : undefined;
  if (transform) applyColorTransform(pixels, transform);
  return pixels;
}
