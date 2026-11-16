import type { ParseRanges } from '@/core/contracts';
import { pdfStrings } from './strings';

// Hyphen plus the dashes people paste from documents (en dash, em dash, minus sign).
const DASH = '[-–—−]';
const RANGE = new RegExp(`^(\\d*)\\s*${DASH}\\s*(\\d*)$`);
const SINGLE = /^\d+$/;

/**
 * "1-3, 5, 8-10" → [[1,2,3],[5],[8,9,10]] (1-based, in the order written).
 * Also accepts "5-" (5 to the end) and "-3" (start to 3), spaces and empty parts ("1-3,").
 * Overlapping ranges are allowed; each range becomes its own part.
 * Throws RangeError with a message that can be shown to the user.
 */
export const parseRanges: ParseRanges = (spec, pageCount) => {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new RangeError(pdfStrings.noPages());

  const parts = spec
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) throw new RangeError(pdfStrings.rangesEmpty);

  return parts.map((part) => {
    const single = SINGLE.test(part);
    const match = single ? null : RANGE.exec(part);
    if (!single && (!match || (match[1] === '' && match[2] === ''))) {
      throw new RangeError(pdfStrings.rangesJunk(part));
    }
    const fromText = single ? part : (match?.[1] ?? '');
    const toText = single ? part : (match?.[2] ?? '');
    const from = fromText === '' ? 1 : toPage(fromText, pageCount);
    const to = toText === '' ? pageCount : toPage(toText, pageCount);
    if (from > to) throw new RangeError(pdfStrings.rangesBackwards(from, to));
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
};

function toPage(digits: string, pageCount: number): number {
  const page = Number(digits);
  if (page === 0) throw new RangeError(pdfStrings.rangesZero);
  if (page > pageCount) {
    // Shown as typed (minus leading zeros): very long numbers would otherwise print as 1e+21.
    throw new RangeError(pdfStrings.pageMissing(digits.replace(/^0+/, ''), pageCount));
  }
  return page;
}
