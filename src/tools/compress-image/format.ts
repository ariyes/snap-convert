// Small display helpers: byte sizes, percentage saved and output file names.
import type { ImageFormat, ImageJobResult } from '@/core/contracts/image';
import { applyNamePattern, uniqueNames } from '@/features/export';
import { compressStrings as t } from './strings';

/** "830 B", "9.4 KB", "155 KB", "2.1 MB" (as in the prototype). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

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

const EXTENSIONS: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

/** "IMG_1.HEIC" → "IMG_1". */
export function baseName(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, '');
  return base || name;
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
