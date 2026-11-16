import { exactPlacement, type Rect, type Size } from '@/core/sizing';

/**
 * `exactPlacement` (the one sizing rule) works in whole units. PDF points are fractional (A4 is 595.28 × 841.89 pt), so
 * placement is done in hundredths of a point, which keeps rounding below 0.01 pt.
 */
const PRECISION = 100;

export interface PointPlacement {
  /** Where the content goes, in points, relative to the box's bottom-left corner (PDF coordinates). */
  target: Rect;
  /** The one uniform scale (content points → page points) for both axes. */
  scale: number;
}

/**
 * Fits `content` (points) inside `box` (points), centred, never stretched. `upscale` lets content
 * grow to fill the box (images and pages on a PDF page are placed with it on).
 */
export function fitInBox(content: Size, box: Size, upscale: boolean): PointPlacement {
  const p = exactPlacement(
    { width: content.width * PRECISION, height: content.height * PRECISION },
    {
      width: Math.round(box.width * PRECISION),
      height: Math.round(box.height * PRECISION),
      fit: 'fit',
      anchor: 'center',
      upscale,
    },
  );
  // exactPlacement measures y from the top; PDF measures it from the bottom.
  const target = {
    x: p.target.x / PRECISION,
    y: (p.canvas.height - p.target.y - p.target.height) / PRECISION,
    width: p.target.width / PRECISION,
    height: p.target.height / PRECISION,
  };
  // Rounding can make width and height scale differ by a hair; use the smaller so x and y
  // scale are exactly equal and the content still fits.
  const scale = Math.min(target.width / content.width, target.height / content.height);
  return { target, scale };
}
