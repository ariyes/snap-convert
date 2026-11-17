// Bulk resize & compress: settings, job inputs and output names. Pure functions, no React.
// Every size here comes from the sizing rule (via planSize / the pipeline's result): nothing is
// worked out by hand.

import type { ImageFormat, ImageJobInput, OutputFormat } from '@/core/contracts/image';
import type { FileKind } from '@/core/contracts/intake';
import type { Size } from '@/core/contracts/sizing';
import { applyNamePattern, uniqueNames } from '@/features/export';
import {
  IMAGE_SETTINGS_DEFAULTS,
  toJobOptions,
  type ImageSettingsValues,
} from '@/features/image-settings';
import {
  baseName,
  EXTENSIONS,
  QUALITY_FLAG_DEFAULT,
  qualityGuardFor,
  type QualityFlag,
} from '@/tools/_shared';

export const TOOL_ID = 'bulk-resize';

/** Bulk's settings: the shared image settings plus the "user set quality" flag (D28/D29). */
export type BulkSettings = ImageSettingsValues & QualityFlag;

/** IMG-08 defaults: longest side 1920 px, JPG, quality 80, `{name}-{width}w`, details removed. */
export const BULK_DEFAULTS: Readonly<BulkSettings> = {
  ...IMAGE_SETTINGS_DEFAULTS,
  ...QUALITY_FLAG_DEFAULT,
  format: 'jpeg',
  quality: 80,
  qualityMode: 'quality',
  resizeEnabled: true,
  resizeMode: 'longest',
  resizeSize: 1920,
  rename: '{name}-{width}w',
  metadata: 'strip-all',
};

export type BulkJobOptions = Omit<ImageJobInput, 'file' | 'name' | 'width' | 'height'>;

/**
 * Everything an image job needs except the file. Bulk has no target-size mode. The quality guard
 * (D28/D29) is on for default runs, and off once the user moved the quality slider.
 */
export function jobOptions(settings: BulkSettings): BulkJobOptions {
  const options = toJobOptions({ ...settings, qualityMode: 'quality' });
  return { ...options, qualityGuard: qualityGuardFor(settings) };
}

/**
 * A key for the settings that change the output pixels or bytes. Results made with another key are
 * stale. The file-name pattern is not part of it: names are applied on export.
 */
export function settingsSignature(settings: BulkSettings): string {
  return JSON.stringify(jobOptions(settings));
}

function sourceFormat(name: string, kind: FileKind): ImageFormat {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (kind === 'heic') return 'jpeg';
  if (ext === 'png' || ext === 'gif' || ext === 'bmp') return 'png';
  if (ext === 'webp') return 'webp';
  if (ext === 'avif') return 'avif';
  return 'jpeg';
}

/** The format a file will most likely be saved in, before it's processed (for names and estimates). */
export function plannedFormat(format: OutputFormat, name: string, kind: FileKind): ImageFormat {
  return format === 'keep' ? sourceFormat(name, kind) : format;
}

export interface NameEntry {
  /** Original file name. */
  name: string;
  width?: number;
  height?: number;
  /** 1-based position in the list. */
  n: number;
  format: ImageFormat;
}

/** One output name: pattern applied to the base name, plus the output extension. */
export function outputName(pattern: string, entry: NameEntry): string {
  const ext = EXTENSIONS[entry.format];
  const base = applyNamePattern(pattern, {
    name: baseName(entry.name),
    width: entry.width,
    height: entry.height,
    n: entry.n,
    format: ext,
  });
  return `${base}.${ext}`;
}

/** Output names for a whole batch, made unique ("a.jpg", "a (2).jpg"). */
export function outputNames(pattern: string, entries: readonly NameEntry[]): string[] {
  return uniqueNames(entries.map((entry) => outputName(pattern, entry)));
}

/**
 * Rough output size in bytes, for the "Estimated: 412 MB → about 38 MB" line before a run.
 * Bits per pixel from typical photos at this quality; only ever shown as "about".
 */
export function estimateBytes(output: Size, format: ImageFormat, quality: number): number {
  const q = Math.min(100, Math.max(1, quality)) / 100;
  let bytesPerPixel = 0.1 + q ** 3 * 0.75;
  if (format === 'webp') bytesPerPixel *= 0.72;
  if (format === 'avif') bytesPerPixel *= 0.55;
  if (format === 'png') bytesPerPixel = 1.4;
  return Math.round(output.width * output.height * bytesPerPixel);
}

/**
 * Rough output size of one file: the typical size at this quality, but never more than the input
 * scaled by the change in pixels (an already small file stays small). PNG output from a lossy
 * source uses the typical size only, since PNG files are much bigger.
 */
export function estimateFileBytes(
  file: { size: number; format: ImageFormat },
  source: Size,
  output: Size,
  format: ImageFormat,
  quality: number,
): number {
  const typical = estimateBytes(output, format, quality);
  if (format === 'png' && file.format !== 'png') return typical;
  const pixelRatio = (output.width * output.height) / Math.max(1, source.width * source.height);
  return Math.round(Math.min(typical, file.size * pixelRatio));
}
