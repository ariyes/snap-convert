// Settings and job input of Optimize for web (P16). Presets come from P12 (WEB_PRESETS); this
// page only picks one and the output format, and never redefines sizes or quality.
import type { ImageJobInput } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import { PRESET_IDS, presetJob, type PresetId } from '@/engines/optimize';
import { oneOf, type SettingsSchema } from '@/features/settings';

export const TOOL_ID = 'optimize-for-web';

/** JPG (default), WebP, or AVIF behind "Advanced". */
export type WebFormat = 'jpeg' | 'webp' | 'avif';
export const WEB_FORMATS: readonly WebFormat[] = ['jpeg', 'webp', 'avif'];

export interface OptimizeSettings {
  destination: PresetId;
  format: WebFormat;
}

export const OPTIMIZE_DEFAULTS: Readonly<OptimizeSettings> = {
  destination: 'web',
  format: 'jpeg',
};

export const optimizeSchema: SettingsSchema<OptimizeSettings> = {
  destination: oneOf(PRESET_IDS),
  format: oneOf(WEB_FORMATS),
};

/** Settings that change the output: when this changes, every image is optimized again. */
export function settingsKey(s: OptimizeSettings): string {
  return `${s.destination}|${s.format}`;
}

/**
 * The image job for one file: the preset's size, quality 80 and "remove everything" metadata, with
 * the quality guard on (D28) and never enlarged. Only the format can differ from the preset.
 */
export function optimizeJobInput(file: IntakeFile, s: OptimizeSettings): ImageJobInput {
  return {
    ...presetJob(s.destination, file.file, file.name),
    format: s.format,
    width: file.width,
    height: file.height,
  };
}
