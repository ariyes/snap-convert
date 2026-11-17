// Decoding without OffscreenCanvas (older Safari workers): JPEG and WebP with jSquash's
// WebAssembly decoders, PNG, GIF and BMP with our own TypeScript decoders. Loaded only in workers
// that need it. Results match the canvas path (fallback.browser.test.ts): EXIF orientation
// applied, colours converted to sRGB from the embedded ICC profile (or PNG's gAMA / cHRM, read as
// Chromium reads them). decodeImage then clears fully transparent pixels to (0, 0, 0, 0), as a
// canvas returns them.

import { applyColorTransform, iccToSrgb, pngChunksToSrgb, type ColorTransform } from './color';
import type { ContainerInfo } from './container';
import { orientPixels } from './orientation';
import { checkDimensions, type RawImage } from './raw';

/**
 * Decodes a JPEG, PNG, WebP, GIF or BMP file to upright sRGB pixels. Throws `PixelDecodeError`
 * (or the WebAssembly decoder's own error) when the file can't be read.
 */
export async function decodeWithoutCanvas(
  bytes: Uint8Array,
  info: ContainerInfo,
  orientation: number,
  maxPixels: number,
): Promise<ImageData> {
  let raw: RawImage;
  let transform: ColorTransform | undefined;
  switch (info.format) {
    case 'jpeg':
      raw = await wasmDecode(bytes, maxPixels, async (buffer) => {
        const { default: decode } = await import('@jsquash/jpeg/decode.js');
        return decode(buffer, { preserveOrientation: false });
      });
      break;
    case 'webp':
      raw = await wasmDecode(bytes, maxPixels, async (buffer) => {
        const { default: decode } = await import('@jsquash/webp/decode.js');
        return decode(buffer);
      });
      break;
    case 'png': {
      const { decodePng } = await import('./png');
      const png = await decodePng(bytes, maxPixels);
      raw = png.image;
      // An ICC profile wins over the other colour chunks; an sRGB chunk means "already sRGB".
      if (!png.iccp && !png.srgb) transform = pngChunksToSrgb(png.gamma, png.chromaticities);
      break;
    }
    case 'gif': {
      const { decodeGif } = await import('./gif');
      raw = decodeGif(bytes, maxPixels);
      break;
    }
    case 'bmp': {
      const { decodeBmp } = await import('./bmp');
      raw = decodeBmp(bytes, maxPixels);
      break;
    }
    default:
      throw new Error(`no canvas-free decoder for ${info.format}`);
  }
  if (info.icc && (info.format === 'jpeg' || info.format === 'png' || info.format === 'webp')) {
    transform = iccToSrgb(info.icc);
  }
  let pixels = new ImageData(raw.data, raw.width, raw.height);
  if (transform) applyColorTransform(pixels, transform);
  if (orientation !== 1) pixels = orientPixels(pixels, orientation);
  return pixels;
}

type Decoded = { data: Uint8ClampedArray; width: number; height: number };

async function wasmDecode(
  bytes: Uint8Array,
  maxPixels: number,
  run: (buffer: ArrayBuffer) => Promise<Decoded>,
): Promise<RawImage> {
  const result = await run(bytes.slice().buffer); // the decoders take an ArrayBuffer of exactly the file
  checkDimensions(result.width, result.height, maxPixels);
  const { width, height } = result;
  const size = width * height * 4;
  const own =
    result.data.byteOffset === 0 &&
    result.data.buffer instanceof ArrayBuffer &&
    result.data.buffer.byteLength === size;
  const data = own
    ? new Uint8ClampedArray(result.data.buffer as ArrayBuffer, 0, size)
    : new Uint8ClampedArray(result.data.subarray(0, size));
  return { width, height, data };
}
