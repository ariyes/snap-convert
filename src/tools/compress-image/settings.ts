// Compress image settings: the shared image settings with Compress's defaults (resize off), the
// quick presets shown as chips, and the pipeline input built from them.
import type { ImageJobInput, WebPreset } from '@/core/contracts/image';
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { minRecommendedSide, WEB_PRESETS } from '@/engines/optimize';
import {
  applyPreset,
  IMAGE_SETTINGS_DEFAULTS,
  imageSettingsSchema,
  toJobOptions,
  type ImageSettingsValues,
} from '@/features/image-settings';
import type { SettingsSchema } from '@/features/settings';
import { QUALITY_FLAG_DEFAULT, qualityGuardFor, type QualityFlag } from '@/tools/_shared';

// The shared quality-guard rule (D28/D29): a manual quality change switches the guard off.
export { withQualityFlag } from '@/tools/_shared';

export const TOOL_ID = 'compress-image';

/** What the drop zone takes: images, HEIC included. */
export const ACCEPT: readonly FileKind[] = ['image', 'heic'];

/** Settings changes reach the preview after this long without another change. */
export const PREVIEW_DEBOUNCE_MS = 250;

/** The sample photo (CC0, public/samples/compress-sample.jpg). */
export const SAMPLE = { path: 'samples/compress-sample.jpg', name: 'sample-photo.jpg' } as const;

/**
 * `qualitySet`: the user moved the quality slider. Until then (defaults and presets) the quality
 * guard may raise quality to keep the photo crisp; afterwards their own quality is used as-is.
 */
export type CompressSettings = ImageSettingsValues & QualityFlag;

/** IMG-04 defaults: quality 80, same format, no resizing, location and camera details removed. */
export const COMPRESS_DEFAULTS: Readonly<CompressSettings> = {
  ...IMAGE_SETTINGS_DEFAULTS,
  ...QUALITY_FLAG_DEFAULT,
  resizeEnabled: false,
};

export const compressSchema: SettingsSchema<CompressSettings> = { ...imageSettingsSchema };

/** The chips of the prototype: WordPress, Shopify, Blog hero, Email, Thumbnail (not plain "Web"). */
export const COMPRESS_PRESETS: readonly WebPreset[] = WEB_PRESETS.filter((p) => p.id !== 'web');

/** A preset chip's settings; the guard applies again (preset run). */
export function presetPatch(preset: WebPreset): Partial<CompressSettings> {
  return { ...applyPreset(preset), qualitySet: false };
}

/** Smallest sharp longest side for the selected preset's use, if any. */
export function recommendedSide(settings: Pick<CompressSettings, 'preset'>): number | undefined {
  return settings.preset ? minRecommendedSide(settings.preset) : undefined;
}

export type JobOptions = Omit<ImageJobInput, 'file' | 'name' | 'width' | 'height'>;

/** Pipeline options for every file (resizing is optional on this page). */
export function jobOptions(settings: CompressSettings): JobOptions {
  return {
    ...toJobOptions(settings, { optional: true }),
    qualityGuard: qualityGuardFor(settings),
  };
}

/**
 * One string per distinct result: results made with another key are stale. jobOptions() always
 * builds its object in the same key order, so equal options give equal keys.
 */
export function optionsKey(options: JobOptions): string {
  return JSON.stringify(options);
}

/** The job input for one file. Intake's size lets the queue run 40 MP+ images alone. */
export function jobInput(file: IntakeFile, options: JobOptions): ImageJobInput {
  return {
    ...options,
    file: file.file,
    name: file.name,
    width: file.width,
    height: file.height,
  };
}
