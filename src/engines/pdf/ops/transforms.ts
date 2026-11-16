import type { Rect, Size } from '@/core/contracts';

/** PDF transformation matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

/** Visible size of an image after its EXIF orientation: 5–8 swap width and height. */
export function orientedSize(stored: Size, orientation: number): Size {
  return orientation >= 5 && orientation <= 8
    ? { width: stored.height, height: stored.width }
    : { width: stored.width, height: stored.height };
}

/**
 * Matrix that draws an image XObject (the unit square, first pixel row at the top) into `box`
 * (page points) the right way up for its EXIF `orientation`. `box` has the oriented proportions.
 */
export function imageMatrix(orientation: number, box: Rect): Matrix {
  const { x, y, width: w, height: h } = box;
  switch (orientation) {
    case 2: return [-w, 0, 0, h, x + w, y]; // mirrored left–right
    case 3: return [-w, 0, 0, -h, x + w, y + h]; // upside down
    case 4: return [w, 0, 0, -h, x, y + h]; // mirrored top–bottom
    case 5: return [0, -h, -w, 0, x + w, y + h]; // mirrored, then turned
    case 6: return [0, -h, w, 0, x, y + h]; // needs a quarter turn clockwise
    case 7: return [0, h, w, 0, x, y]; // mirrored, then turned
    case 8: return [0, h, -w, 0, x + w, y]; // needs a quarter turn anticlockwise
    default: return [w, 0, 0, h, x, y];
  }
}

/** Page /Rotate as 0, 90, 180 or 270 (PDF allows any multiple of 90, including negative). */
export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const quarter = (((Math.round(angle / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  return ([0, 90, 180, 270] as const)[quarter];
}

/** Visible size of a page after its /Rotate. */
export function rotatedSize(size: Size, rotation: 0 | 90 | 180 | 270): Size {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * Matrix that draws an embedded page (content `size`, origin at its bottom-left) at uniform
 * `scale` with its bottom-left visible corner at (x, y), applying the page's /Rotate so the
 * content looks the way it did in the original viewer (the new page itself has no /Rotate).
 */
export function pageMatrix(
  rotation: 0 | 90 | 180 | 270,
  size: Size,
  scale: number,
  x: number,
  y: number,
): Matrix {
  const s = scale;
  const { width: w, height: h } = size;
  switch (rotation) {
    case 90: return [0, -s, s, 0, x, y + s * w];
    case 180: return [-s, 0, 0, -s, x + s * w, y + s * h];
    case 270: return [0, s, -s, 0, x + s * h, y];
    default: return [s, 0, 0, s, x, y];
  }
}
