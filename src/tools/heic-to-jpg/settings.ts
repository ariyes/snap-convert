// HEIC to JPG settings: JPG (or PNG) at quality 90, upright, location removed by default.
import type { ImageFormat } from '@/core/contracts/image';
import {
  IMAGE_SETTINGS_DEFAULTS,
  imageSettingsSchema,
  toJobOptions,
  type ImageSettingsValues,
} from '@/features/image-settings';
import { oneOf, type SettingsSchema } from '@/features/settings';
import type { ImageJobOptions } from '@/tools/_shared';

export const HEIC_FORMATS: readonly ImageFormat[] = ['jpeg', 'png'];

export interface HeicToolSettings extends Omit<ImageSettingsValues, 'format'> {
  format: ImageFormat;
}

export const HEIC_DEFAULTS: Readonly<HeicToolSettings> = {
  ...IMAGE_SETTINGS_DEFAULTS,
  format: 'jpeg',
  quality: 90,
  metadata: 'strip-location',
  resizeEnabled: false,
};

export const heicSettingsSchema: SettingsSchema<HeicToolSettings> = {
  ...imageSettingsSchema,
  format: oneOf(HEIC_FORMATS),
};

/**
 * Job settings for every photo: full size (the decoder applies the photo's rotation, so it stays
 * upright), the chosen format and quality, and the metadata policy. The quality guard runs while
 * quality is the default (D28, D29).
 */
export function heicJobOptions(settings: HeicToolSettings): ImageJobOptions {
  return {
    ...toJobOptions({ ...settings, qualityMode: 'quality' }, { optional: true }),
    resize: undefined,
    exact: undefined,
    qualityGuard: settings.quality === HEIC_DEFAULTS.quality,
  };
}
