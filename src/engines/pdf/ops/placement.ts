import type { ExactPlacement, Rect, Size } from '@/core/contracts';

// TODO(governor): replace with src/core/sizing exactPlacement after P03 merges
/**
 * Stand-in for `exactPlacement` from `src/core/sizing`, `fit` mode only (the only mode the PDF
 * operations use): scale = min(boxW / w, boxH / h), capped at 1 unless `upscale`; whole units;
 * centred (the only anchor the PDF operations use). Never stretches.
 */
export const exactPlacement: ExactPlacement = (src, o) => {
  if (o.fit !== 'fit') throw new RangeError('Only fit placement is available here');
  for (const n of [src.width, src.height, o.width, o.height]) {
    if (!Number.isFinite(n) || n <= 0) throw new RangeError('Sizes must be positive numbers');
  }
  let scale = Math.min(o.width / src.width, o.height / src.height);
  if (!o.upscale) scale = Math.min(scale, 1);
  const width = Math.min(o.width, Math.max(1, Math.round(src.width * scale)));
  const height = Math.min(o.height, Math.max(1, Math.round(src.height * scale)));
  return {
    canvas: { width: o.width, height: o.height },
    source: { x: 0, y: 0, width: src.width, height: src.height },
    target: {
      x: Math.round((o.width - width) / 2),
      y: Math.round((o.height - height) / 2),
      width,
      height,
    },
    padded: width < o.width || height < o.height,
    cropped: false,
    enlarged: scale > 1,
  };
};

/**
 * `exactPlacement` rounds to whole units. PDF points are fractional (A4 is 595.28 × 841.89 pt), so
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
