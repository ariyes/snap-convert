import type { Size } from '@/core/contracts/sizing';
import { fitSize } from '@/core/sizing';

/** Higher ratios cost memory without a visible gain at thumbnail size. */
const MAX_PIXEL_RATIO = 3;

/** The screen's device pixel ratio, clamped to 1–3. */
export function pixelRatio(): number {
  const ratio = globalThis.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 1 ? Math.min(ratio, MAX_PIXEL_RATIO) : 1;
}

/** Long side in device pixels for a thumbnail shown `maxSize` CSS pixels on its long side. */
export function thumbnailLongSide(maxSize: number, ratio = pixelRatio()): number {
  if (!Number.isFinite(maxSize) || maxSize <= 0) {
    throw new RangeError(`Thumbnail size must be a positive number, got ${maxSize}`);
  }
  return Math.max(1, Math.round(maxSize * ratio));
}

/**
 * Canvas size and render scale for a page drawn with its long side = `longSide` px.
 * One scale for both sides, so the page is never stretched. Small pages are drawn larger:
 * a PDF page is vector content, so this sharpens rather than enlarges pixels.
 */
export function thumbnailCanvasSize(page: Size, longSide: number): Size & { scale: number } {
  const { width, height, scale } = fitSize(page, {
    mode: 'longest',
    value: longSide,
    upscale: true,
  });
  return { width, height, scale };
}
