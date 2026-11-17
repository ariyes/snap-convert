// Shared types for the pure-TypeScript decoders (PNG, GIF, BMP) used when a worker has no
// OffscreenCanvas. They return plain RGBA arrays (not ImageData), so they also run in unit tests
// without a browser; the caller wraps the result.

/** Straight (not premultiplied) 8-bit RGBA pixels, row by row from the top-left. */
export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * A file the pure decoders can't read: broken, truncated or a variant we don't support.
 * `tooLarge` means the stored size is over the caller's pixel limit. The message is for
 * developers; the decode step turns it into a user-readable DecodeError.
 */
export class PixelDecodeError extends Error {
  readonly tooLarge: boolean;
  constructor(message: string, tooLarge = false) {
    super(message);
    this.name = 'PixelDecodeError';
    this.tooLarge = tooLarge;
  }
}

/** Throws if `width × height` is empty, not whole, or over `maxPixels`. */
export function checkDimensions(width: number, height: number, maxPixels: number): void {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
    throw new PixelDecodeError(`bad image size ${width}×${height}`);
  }
  if (width * height > maxPixels) {
    throw new PixelDecodeError(`image too large: ${width}×${height}`, true);
  }
}

/** Sets R, G and B to 0 wherever alpha is 0, as reading pixels back from a canvas does. */
export function clearTransparent(data: Uint8ClampedArray): void {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) {
      data[i - 3] = 0;
      data[i - 2] = 0;
      data[i - 1] = 0;
    }
  }
}
