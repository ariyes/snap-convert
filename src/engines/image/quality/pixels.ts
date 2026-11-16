/**
 * The parts of `ImageData` the quality tools read. `ImageData` itself satisfies this, and plain
 * objects work too, so the maths can be unit-tested without a browser.
 */
export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export function assertPixels(img: Pixels, label: string): void {
  const { width, height, data } = img;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`${label}: width and height must be positive integers`);
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(`${label}: pixel data does not match ${width}×${height} RGBA`);
  }
}
