// Convert image settings (IMG-01): a target format (required), quality 85, a background colour for
// transparent images saved as JPG, and no resizing unless "Also resize" is turned on.
import type { ImageFormat } from '@/core/contracts/image';
import {
  IMAGE_SETTINGS_DEFAULTS,
  imageSettingsSchema,
  toJobOptions,
  type ImageSettingsValues,
  type ResizeFieldMode,
} from '@/features/image-settings';
import { oneOf, type SettingCheck, type SettingsSchema } from '@/features/settings';
import {
  QUALITY_FLAG_DEFAULT,
  qualityGuardFor,
  type ImageJobOptions,
  type QualityFlag,
} from '@/tools/_shared';

/** Formats Convert saves to; there is no "Same as original" here. */
export const CONVERT_FORMATS: readonly ImageFormat[] = ['jpeg', 'png', 'webp', 'avif'];

/** "Also resize" modes (as in Compress). */
export const CONVERT_RESIZE_MODES: readonly ResizeFieldMode[] = [
  'longest',
  'width',
  'height',
  'percent',
];

export interface ConvertToolSettings extends Omit<ImageSettingsValues, 'format'>, QualityFlag {
  format: ImageFormat;
  /** Colour behind transparent areas when saving as JPG (D29). */
  background: string;
}

export const CONVERT_DEFAULTS: Readonly<ConvertToolSettings> = {
  ...QUALITY_FLAG_DEFAULT,
  ...IMAGE_SETTINGS_DEFAULTS,
  format: 'jpeg',
  quality: 85,
  resizeEnabled: false,
  background: '#ffffff',
};

const isHexColour: SettingCheck<string> = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export const convertSettingsSchema: SettingsSchema<ConvertToolSettings> = {
  ...imageSettingsSchema,
  format: oneOf(CONVERT_FORMATS),
  resizeMode: oneOf(CONVERT_RESIZE_MODES),
  background: isHexColour,
};

/** Job settings for every file. The quality guard runs until the user sets the quality (D28, D29). */
export function convertJobOptions(settings: ConvertToolSettings): ImageJobOptions {
  return {
    ...toJobOptions({ ...settings, qualityMode: 'quality' }, { optional: true }),
    background: settings.background,
    qualityGuard: qualityGuardFor(settings),
  };
}
