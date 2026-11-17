// File names for finished results (IMG-09): the tool's pattern, or the original name with the new
// extension, then made unique ("a.jpg", "a (2).jpg").
import type { ImageFormat } from '@/core/contracts/image';
import { applyNamePattern, uniqueNames } from '@/features/export';

/** File extension for each output format. */
export const EXTENSIONS: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

/** "IMG_1.final.HEIC" → "IMG_1.final". */
export function baseName(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]*$/, '');
  return base || fileName;
}

export interface NamedResult {
  /** The input file's name. */
  fileName: string;
  /** 1-based position of the file in the tool's list ({n}). */
  n: number;
  width: number;
  height: number;
  format: ImageFormat;
}

/** One output name, before uniqueness. Without a pattern: original base name + new extension. */
export function outputFileName(item: NamedResult, pattern?: string): string {
  const ext = EXTENSIONS[item.format];
  const name = baseName(item.fileName);
  const base =
    pattern === undefined || pattern.trim() === ''
      ? name
      : applyNamePattern(pattern, {
          name,
          width: item.width,
          height: item.height,
          n: item.n,
          format: ext,
        });
  return `${base}.${ext}`;
}

/** Output names for all results, unique ignoring letter case. */
export function outputFileNames(items: readonly NamedResult[], pattern?: string): string[] {
  return uniqueNames(items.map((item) => outputFileName(item, pattern)));
}
