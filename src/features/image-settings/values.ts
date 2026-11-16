// The settings the shared image controls edit, as one flat object so a tool can keep them with
// useToolSettings and pass `update` straight to each control. Tools pick the keys they need.

import type { ExactOptions, FitMode, ResizeOptions } from '@/core/contracts/sizing';
import type {
  ImageJobInput,
  MetadataPolicy,
  OutputFormat,
  WebPreset,
} from '@/core/contracts/image';
import { numberIn, oneOf, type SettingCheck, type SettingsSchema } from '@/features/settings';

/** Resize modes offered by <ResizeFields>: the sizing modes plus "Exact size (fit or fill)". */
export type ResizeFieldMode = 'longest' | 'width' | 'height' | 'percent' | 'exact' | 'none';
export type QualityMode = 'quality' | 'target';

export const RESIZE_FIELD_MODES: readonly ResizeFieldMode[] = [
  'longest',
  'width',
  'height',
  'percent',
  'exact',
  'none',
];
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['keep', 'jpeg', 'png', 'webp', 'avif'];
export const METADATA_POLICIES: readonly MetadataPolicy[] = [
  'strip-all',
  'strip-location',
  'keep-all',
];
export const PRESET_IDS: ReadonlyArray<WebPreset['id']> = [
  'web',
  'wordpress',
  'shopify',
  'blog',
  'email',
  'thumbnail',
];

/** Limits of the number fields. */
export const LIMITS = {
  quality: { min: 10, max: 100 },
  targetKb: { min: 10, max: 1_000_000 },
  side: { min: 1, max: 50_000 },
  /** Percentage without enlarging, and with "Enlarge smaller images" on. */
  percent: { min: 1, max: 100, maxUpscale: 400 },
  rename: { maxLength: 200 },
} as const;

export interface ImageSettingsValues {
  /** Selected quick preset; any manual change sets it back to null ("custom"). */
  preset: WebPreset['id'] | null;
  qualityMode: QualityMode;
  /** 10–100. */
  quality: number;
  /** "Make each file smaller than" in KB. */
  targetKb: number;
  format: OutputFormat;
  /** Only used by tools where resizing is optional ("Also resize"). */
  resizeEnabled: boolean;
  resizeMode: ResizeFieldMode;
  /** Pixels, for longest / width / height. */
  resizeSize: number;
  /** For percent. */
  resizePercent: number;
  /** Box for exact. */
  exactWidth: number;
  exactHeight: number;
  fit: FitMode;
  /** CSS colour like '#ffffff', or 'transparent'. */
  padColor: string;
  /** Off by default: never enlarge unless the user asks. */
  upscale: boolean;
  metadata: MetadataPolicy;
  /** File-name pattern, e.g. '{name}-{width}w'. */
  rename: string;
}

/** Defaults from the product docs; each tool overrides what differs (e.g. Compress: resize off). */
export const IMAGE_SETTINGS_DEFAULTS: Readonly<ImageSettingsValues> = {
  preset: null,
  qualityMode: 'quality',
  quality: 80,
  targetKb: 200,
  format: 'keep',
  resizeEnabled: true,
  resizeMode: 'longest',
  resizeSize: 1920,
  resizePercent: 50,
  exactWidth: 1080,
  exactHeight: 1080,
  fit: 'fit',
  padColor: '#ffffff',
  upscale: false,
  metadata: 'strip-all',
  rename: '{name}-{width}w',
};

const isPadColor: SettingCheck<string> = (value: unknown): value is string =>
  typeof value === 'string' && (value === 'transparent' || /^#[0-9a-f]{6}$/i.test(value));

const isPattern: SettingCheck<string> = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= LIMITS.rename.maxLength;

/** Stricter checks for stored settings (pass to useToolSettings as the schema). */
export const imageSettingsSchema: SettingsSchema<ImageSettingsValues> = {
  preset: oneOf([null, ...PRESET_IDS]),
  qualityMode: oneOf(['quality', 'target'] as const),
  quality: numberIn(LIMITS.quality.min, LIMITS.quality.max),
  targetKb: numberIn(LIMITS.targetKb.min, LIMITS.targetKb.max),
  format: oneOf(OUTPUT_FORMATS),
  resizeMode: oneOf(RESIZE_FIELD_MODES),
  resizeSize: numberIn(LIMITS.side.min, LIMITS.side.max),
  resizePercent: numberIn(LIMITS.percent.min, LIMITS.percent.maxUpscale),
  exactWidth: numberIn(LIMITS.side.min, LIMITS.side.max),
  exactHeight: numberIn(LIMITS.side.min, LIMITS.side.max),
  fit: oneOf(['fit', 'fill'] as const),
  padColor: isPadColor,
  metadata: oneOf(METADATA_POLICIES),
  rename: isPattern,
};

/** The settings a quick preset sets (as in the prototype): size, format, quality and metadata. */
export function applyPreset(preset: WebPreset): Partial<ImageSettingsValues> {
  return {
    preset: preset.id,
    qualityMode: 'quality',
    quality: preset.quality,
    format: preset.format,
    metadata: preset.metadata,
    resizeEnabled: true,
    resizeMode: 'longest',
    resizeSize: preset.longestSide,
  };
}

/**
 * Wraps a settings `update` so any manual change clears the selected preset ("custom"), while
 * a patch that sets `preset` itself (applyPreset) keeps it.
 */
export function clearPresetOnChange<T extends { preset: WebPreset['id'] | null }>(
  update: (patch: Partial<T>) => void,
): (patch: Partial<T>) => void {
  return (patch) => update('preset' in patch ? patch : { ...patch, preset: null });
}

export type ResizeValues = Pick<
  ImageSettingsValues,
  | 'resizeEnabled'
  | 'resizeMode'
  | 'resizeSize'
  | 'resizePercent'
  | 'exactWidth'
  | 'exactHeight'
  | 'fit'
  | 'padColor'
  | 'upscale'
>;

/** Resize settings as the pipeline takes them (ImageJobInput): `resize` or `exact`, or neither. */
export function toJobSizing(
  v: ResizeValues,
  { optional = false }: { optional?: boolean } = {},
): { resize?: ResizeOptions; exact?: ExactOptions & { padColor?: string } } {
  if ((optional && !v.resizeEnabled) || v.resizeMode === 'none') return {};
  if (v.resizeMode === 'exact') {
    return {
      exact: {
        width: v.exactWidth,
        height: v.exactHeight,
        fit: v.fit,
        upscale: v.upscale,
        padColor: v.padColor,
      },
    };
  }
  const value = v.resizeMode === 'percent' ? v.resizePercent : v.resizeSize;
  return { resize: { mode: v.resizeMode, value, upscale: v.upscale } };
}

/** Everything a tool needs for an image job, except the file. */
export function toJobOptions(
  v: ResizeValues &
    Pick<ImageSettingsValues, 'qualityMode' | 'quality' | 'targetKb' | 'format' | 'metadata'>,
  options?: { optional?: boolean },
): Omit<ImageJobInput, 'file' | 'name' | 'width' | 'height'> {
  return {
    ...toJobSizing(v, options),
    format: v.format,
    quality: v.quality,
    targetBytes: v.qualityMode === 'target' ? v.targetKb * 1024 : undefined,
    metadata: v.metadata,
  };
}
