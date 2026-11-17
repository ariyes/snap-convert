// Small display helpers: percentage saved and output file names (sizes: tools/_shared).
import type { ImageFormat, ImageJobResult } from '@/core/contracts/image';
import { applyNamePattern, uniqueNames } from '@/features/export';
import { baseName, EXTENSIONS } from '@/tools/_shared';
import { compressStrings as t } from './strings';

/**
 * Change in size as a whole percentage: positive when smaller (saved), negative when bigger.
 * A change under 1% rounds to 0.
 */
export function savedPercent(original: number, result: number): number {
  if (!(original > 0) || !Number.isFinite(result)) return 0;
  const value = Math.round((1 - result / original) * 100);
  return value === 0 ? 0 : value; // never -0
}

/** "−42%", "None", or "+17%" for a bigger file. */
export function savedText(original: number, result: number): string {
  const p = savedPercent(original, result);
  if (p > 0) return `−${p}%`;
  if (p < 0) return `+${-p}%`;
  return t.savedNone;
}

/** `<name>-compressed.<ext>`, the extension from the format actually saved. */
export function compressedName(sourceName: string, format: ImageFormat, n = 1): string {
  const base = applyNamePattern(`{name}${t.nameSuffix}`, {
    name: baseName(sourceName),
    n,
    format: EXTENSIONS[format],
  });
  return `${base}.${EXTENSIONS[format]}`;
}

/** Download names for results, in order, made unique ("a-compressed (2).jpg"). */
export function downloadNames(
  items: ReadonlyArray<{ sourceName: string; result: Pick<ImageJobResult, 'format'> }>,
): string[] {
  return uniqueNames(
    items.map((item, i) => compressedName(item.sourceName, item.result.format, i + 1)),
  );
}
