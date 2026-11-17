// Resize image settings (IMG-02, IMG-03, IMG-09): every resize mode incl. Exact size, format "Same
// as original", quality 85 (resizing users expect top quality), names "{name}-{width}x{height}".
import type { Anchor } from '@/core/contracts/sizing';
import {
  IMAGE_SETTINGS_DEFAULTS,
  imageSettingsSchema,
  toJobOptions,
  type ImageSettingsValues,
  type ResizeFieldMode,
} from '@/features/image-settings';
import { oneOf, type SettingsSchema } from '@/features/settings';
import {
  QUALITY_FLAG_DEFAULT,
  qualityGuardFor,
  type ImageJobOptions,
  type QualityFlag,
} from '@/tools/_shared';

/** The 3 × 3 crop positions, row by row. */
export const ANCHORS: readonly Anchor[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

/** Resize always resizes, so "Don't resize" isn't offered. */
export const RESIZE_MODES: readonly ResizeFieldMode[] = [
  'longest',
  'width',
  'height',
  'percent',
  'exact',
];

export interface ResizeToolSettings extends ImageSettingsValues, QualityFlag {
  /** Which part Fill keeps. */
  anchor: Anchor;
}

export const RESIZE_DEFAULTS: Readonly<ResizeToolSettings> = {
  ...IMAGE_SETTINGS_DEFAULTS,
  ...QUALITY_FLAG_DEFAULT,
  format: 'keep',
  quality: 85,
  resizeEnabled: true,
  resizeMode: 'longest',
  rename: '{name}-{width}x{height}',
  anchor: 'center',
};

export const resizeSettingsSchema: SettingsSchema<ResizeToolSettings> = {
  ...imageSettingsSchema,
  resizeMode: oneOf(RESIZE_MODES),
  anchor: oneOf(ANCHORS),
};

/** Job settings for every file. The quality guard runs until the user sets the quality (D28, D29). */
export function resizeJobOptions(settings: ResizeToolSettings): ImageJobOptions {
  const options = toJobOptions({ ...settings, qualityMode: 'quality', resizeEnabled: true });
  return {
    ...options,
    // The crop position is offered for Fill only; Fit always centres the image (sizing rule).
    exact: options.exact && {
      ...options.exact,
      anchor: options.exact.fit === 'fill' ? settings.anchor : 'center',
    },
    qualityGuard: qualityGuardFor(settings),
  };
}
