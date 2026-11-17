import type { Size } from '@/core/contracts/sizing';
import { fitSize } from '@/core/sizing';

/** Pixel limits for a page saved as an image (P31, PDF-06). */
export const PAGE_IMAGE_LIMITS = {
  /** Most pixels a saved page may have (50 MP). */
  maxPixels: 50_000_000,
  /** Used instead when this browser can't make a 50 MP canvas (e.g. iPhone Safari). */
  smallDevicePixels: 16_000_000,
  /** Longest side any browser can draw and decode reliably. */
  maxSide: 16_384,
  /** DPI range offered to the user. */
  minDpi: 36,
  maxDpi: 600,
} as const;

export interface PageImageSize extends Size {
  /** pdf.js viewport scale: output pixels per PDF point. One scale for both sides. */
  scale: number;
  /** The DPI the page is drawn at: the one asked for, or less when `reduced`. */
  dpi: number;
  /** The page was drawn at a lower DPI to stay within the pixel limits. */
  reduced: boolean;
}

/** Points are 1/72 in. */
const POINTS_PER_INCH = 72;

function sizeAt(page: Size, dpi: number) {
  const longest = Math.max(page.width, page.height);
  // Both sides from one scale (the sizing rule): never stretched. A PDF page is vector content,
  // so drawing it larger sharpens it rather than enlarging pixels.
  return fitSize(page, {
    mode: 'longest',
    value: Math.max(1, Math.round((longest * dpi) / POINTS_PER_INCH)),
    upscale: true,
  });
}

/**
 * Pixel size of a page (in PDF points, as displayed: rotation applied) drawn at `dpi`. When that
 * would exceed `maxPixels` or `maxSide`, the largest whole DPI that fits is used instead and
 * `reduced` is set.
 */
export function pageImageSize(
  page: Size,
  dpi: number,
  maxPixels: number = PAGE_IMAGE_LIMITS.maxPixels,
  maxSide: number = PAGE_IMAGE_LIMITS.maxSide,
): PageImageSize {
  if (!(page.width > 0 && page.height > 0) || !Number.isFinite(page.width + page.height)) {
    throw new RangeError(`Page size must be positive, got ${page.width} × ${page.height}`);
  }
  if (!(dpi > 0) || !Number.isFinite(dpi)) {
    throw new RangeError(`DPI must be a positive number, got ${dpi}`);
  }
  const fits = (s: Size) =>
    s.width * s.height <= maxPixels && Math.max(s.width, s.height) <= maxSide;
  const result = (s: ReturnType<typeof sizeAt>, used: number, reduced: boolean) => ({
    width: s.width,
    height: s.height,
    scale: s.scale,
    dpi: used,
    reduced,
  });

  const wanted = sizeAt(page, dpi);
  if (fits(wanted)) return result(wanted, dpi, false);

  // The largest whole DPI within both limits (rounding can push the estimate one step over).
  const longest = Math.max(page.width, page.height);
  const byPixels = POINTS_PER_INCH * Math.sqrt(maxPixels / (page.width * page.height));
  const bySide = (POINTS_PER_INCH * maxSide) / longest;
  let reducedDpi = Math.floor(Math.min(dpi, byPixels, bySide));
  while (reducedDpi > 1 && !fits(sizeAt(page, reducedDpi))) reducedDpi--;
  if (reducedDpi >= 1 && fits(sizeAt(page, reducedDpi))) {
    return result(sizeAt(page, reducedDpi), reducedDpi, true);
  }

  // A page so large that even 1 DPI is too big (only possible with a huge UserUnit): the largest
  // longest side that fits, with its DPI rounded down for display.
  const ratio = Math.min(page.width, page.height) / longest;
  let side = Math.max(1, Math.floor(Math.min(maxSide, Math.sqrt(maxPixels / ratio))));
  let s = fitSize(page, { mode: 'longest', value: side, upscale: true });
  while (side > 1 && !fits(s)) {
    side--;
    s = fitSize(page, { mode: 'longest', value: side, upscale: true });
  }
  return result(s, Math.max(0.01, Math.floor(s.scale * POINTS_PER_INCH * 100) / 100), true);
}
