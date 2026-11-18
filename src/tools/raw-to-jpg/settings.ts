// RAW to JPG (P30): remembered settings and the image job each RAW file becomes. Pure functions, no
// React. Output sizes come from the sizing rule (toJobSizing → the pipeline; planSize for previews).

import type { ImageFormat, ImageJobInput, RawOptions } from '@/core/contracts/image';
import {
  IMAGE_SETTINGS_DEFAULTS,
  imageSettingsSchema,
  toJobSizing,
  type ImageSettingsValues,
  type ResizeValues,
} from '@/features/image-settings';
import { numberIn, oneOf, type SettingCheck, type SettingsSchema } from '@/features/settings';

export const TOOL_ID = 'raw-to-jpg';

export const RAW_FORMATS: readonly ImageFormat[] = ['jpeg', 'png', 'webp', 'avif'];
export const QUALITY_MODES = ['auto', 'custom'] as const;
export type QualityChoice = (typeof QUALITY_MODES)[number];

/** Exposure slider: −2…+2 stops in half stops (the engine's own range). */
export const EXPOSURE = { min: -2, max: 2, step: 0.5 } as const;

/** Quality the guard starts from in Auto; it only ever raises it (D28/D29). Photographers' files. */
export const AUTO_QUALITY = 90;

export interface RawToJpgSettings
  extends ResizeValues, Pick<ImageSettingsValues, 'metadata' | 'rename'> {
  /** Fast: the camera's own JPEG when there is one. Full: develop the RAW data. */
  mode: RawOptions['mode'];
  whiteBalance: RawOptions['whiteBalance'];
  /** Stops, −2…+2 in half stops. */
  exposure: number;
  highlights: RawOptions['highlights'];
  format: ImageFormat;
  /** Auto: the quality guard keeps every photo crisp. Custom: the user's quality, as set. */
  qualityMode: QualityChoice;
  /** 10–100, used in Custom. */
  quality: number;
}

export const RAW_DEFAULTS: Readonly<RawToJpgSettings> = {
  mode: 'fast',
  whiteBalance: 'as-shot',
  exposure: 0,
  highlights: 'clip',
  format: 'jpeg',
  qualityMode: 'auto',
  quality: AUTO_QUALITY,
  // Full size unless the user asks for smaller ("Also resize"); never enlarged by default.
  resizeEnabled: false,
  resizeMode: 'longest',
  resizeSize: 2560,
  resizePercent: IMAGE_SETTINGS_DEFAULTS.resizePercent,
  exactWidth: IMAGE_SETTINGS_DEFAULTS.exactWidth,
  exactHeight: IMAGE_SETTINGS_DEFAULTS.exactHeight,
  fit: IMAGE_SETTINGS_DEFAULTS.fit,
  padColor: IMAGE_SETTINGS_DEFAULTS.padColor,
  upscale: false,
  // Keep camera details (date, lens, exposure), remove the location.
  metadata: 'strip-location',
  // "<name>.jpg"
  rename: '{name}',
};

const isExposure: SettingCheck<number> = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= EXPOSURE.min &&
  value <= EXPOSURE.max &&
  Number.isInteger(value / EXPOSURE.step);

export const RAW_SCHEMA: SettingsSchema<RawToJpgSettings> = {
  mode: oneOf(['fast', 'full'] as const),
  whiteBalance: oneOf(['as-shot', 'auto'] as const),
  exposure: isExposure,
  highlights: oneOf(['clip', 'recover'] as const),
  format: oneOf(RAW_FORMATS),
  qualityMode: oneOf(QUALITY_MODES),
  quality: numberIn(10, 100),
  resizeMode: imageSettingsSchema.resizeMode,
  resizeSize: imageSettingsSchema.resizeSize,
  resizePercent: imageSettingsSchema.resizePercent,
  exactWidth: imageSettingsSchema.exactWidth,
  exactHeight: imageSettingsSchema.exactHeight,
  fit: imageSettingsSchema.fit,
  padColor: imageSettingsSchema.padColor,
  metadata: imageSettingsSchema.metadata,
  rename: imageSettingsSchema.rename,
};

/** "+1 EV", "−0.5 EV", "0 EV". */
export function formatExposure(stops: number): string {
  if (stops === 0) return '0 EV';
  const sign = stops > 0 ? '+' : '−';
  return `${sign}${Math.abs(stops)} EV`;
}

/**
 * How the RAW file is turned into pixels. Fast mode sends the defaults: the develop settings are
 * only shown (and only apply) in Full quality, so changing them while in Fast changes nothing.
 * (Fast mode still develops files whose camera JPEG is too small, with the neutral defaults.)
 */
export function rawOptions(s: RawToJpgSettings): RawOptions {
  if (s.mode === 'fast') {
    return { mode: 'fast', whiteBalance: 'as-shot', exposure: 0, highlights: 'clip' };
  }
  const exposure = Math.max(EXPOSURE.min, Math.min(EXPOSURE.max, s.exposure));
  return {
    mode: 'full',
    whiteBalance: s.whiteBalance,
    exposure: Math.round(exposure / EXPOSURE.step) * EXPOSURE.step,
    highlights: s.highlights,
  };
}

export type RawJobOptions = Omit<ImageJobInput, 'file' | 'name' | 'width' | 'height'>;

/**
 * Everything a RAW job needs except the file: the RAW develop options, the optional resize (from
 * the sizing rule, never enlarged unless asked), the format, quality and metadata policy. Auto
 * quality runs the quality guard (D28/D29); a quality the user chose is used as it is.
 */
export function jobOptions(s: RawToJpgSettings): RawJobOptions {
  const auto = s.qualityMode === 'auto';
  return {
    ...toJobSizing(s, { optional: true }),
    format: s.format,
    quality: auto ? AUTO_QUALITY : s.quality,
    metadata: s.metadata,
    qualityGuard: auto,
    raw: rawOptions(s),
  };
}

/** The job for one file. `size` comes from readRawInfo, so the queue runs 40 MP+ files alone (D27). */
export function jobInput(
  s: RawToJpgSettings,
  file: File,
  size: { width: number; height: number } | undefined,
): ImageJobInput {
  const input: ImageJobInput = { ...jobOptions(s), file, name: file.name };
  if (size) {
    input.width = size.width;
    input.height = size.height;
  }
  return input;
}

/**
 * A key for the settings that change the output; results made with another key are stale. The
 * name pattern isn't part of it (names are applied on export).
 */
export function settingsSignature(s: RawToJpgSettings): string {
  return JSON.stringify(jobOptions(s));
}
