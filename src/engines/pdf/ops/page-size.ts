import type { NamedPageSize, PageOrientation, Size } from '@/core/contracts';
import { PdfOpError } from './errors';
import { pdfStrings } from './strings';

/** Portrait page sizes in points (1/72 inch) — the same values pdf-lib's `PageSizes` uses. */
export const NAMED_PAGE_SIZES: Readonly<Record<NamedPageSize, Size>> = {
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
};

/** Largest page side PDF readers accept: 200 inches. */
export const MAX_PAGE_POINTS = 14_400;

const POINTS_PER_MM = 72 / 25.4;

export function mmToPoints(mm: number): number {
  return mm * POINTS_PER_MM;
}

/** A named size, or a custom size in points (checked to be between 1 and 14,400 pt). */
export function pageSizePoints(size: NamedPageSize | Size): Size {
  if (typeof size === 'string') {
    const named = NAMED_PAGE_SIZES[size];
    if (!named) throw new PdfOpError('bad-input', pdfStrings.badPageSize);
    return named;
  }
  const ok = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= MAX_PAGE_POINTS;
  if (!ok(size.width) || !ok(size.height))
    throw new PdfOpError('bad-input', pdfStrings.badPageSize);
  return { width: size.width, height: size.height };
}

/**
 * Turns `page` portrait or landscape. `auto` follows `content`: landscape when the content is
 * wider than tall, portrait otherwise. Only swaps the sides; never changes the size.
 */
export function orientPage(page: Size, orientation: PageOrientation, content: Size): Size {
  const landscape =
    orientation === 'landscape' || (orientation === 'auto' && content.width > content.height);
  const long = Math.max(page.width, page.height);
  const short = Math.min(page.width, page.height);
  return landscape ? { width: long, height: short } : { width: short, height: long };
}
