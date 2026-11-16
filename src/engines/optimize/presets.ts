// IMG-06 "Optimize for web" presets (docs/03-features.md, web defaults table).
import type { ImageJobInput, WebPreset } from '@/core/contracts/image';
import { presetNames } from './strings';

export type PresetId = WebPreset['id'];

function preset(id: PresetId, longestSide: number): WebPreset {
  return {
    id,
    name: presetNames[id],
    longestSide,
    format: 'jpeg',
    quality: 80,
    metadata: 'strip-all',
  };
}

/**
 * Retina-ready sizes (D24): big enough to look sharp on high-density screens. All progressive
 * JPEG at quality 80 with metadata stripped; never enlarged.
 */
export const WEB_PRESETS: readonly WebPreset[] = [
  preset('web', 1920),
  preset('wordpress', 2048),
  preset('shopify', 2048),
  preset('blog', 1600),
  preset('email', 800),
  preset('thumbnail', 400),
];

export const PRESET_IDS: readonly PresetId[] = WEB_PRESETS.map((p) => p.id);

export function getPreset(id: PresetId): WebPreset {
  const found = WEB_PRESETS.find((p) => p.id === id);
  if (!found) throw new RangeError(`Unknown preset "${String(id)}"`);
  return found;
}

/**
 * Below this longest side the output looks small or soft for the preset's use, so the UI shows
 * the "small for its use" warning (e.g. under 1200 px for a full-width image).
 */
const MIN_RECOMMENDED: Record<PresetId, number> = {
  web: 1200, // full-width image
  wordpress: 1200, // full-width content image
  shopify: 1024, // product zoom needs at least ~1000 px
  blog: 1200, // full-width hero
  email: 600, // standard email body width
  thumbnail: 200, // 2× a typical 100 px thumbnail
};

export function minRecommendedSide(presetId: PresetId): number {
  return MIN_RECOMMENDED[presetId];
}

/** The pipeline input for a preset run (the quality guard applies, D28). */
export function presetJob(
  presetId: PresetId,
  file: Blob,
  name: string,
): ImageJobInput & { qualityGuard: true } {
  const p = getPreset(presetId);
  return {
    file,
    name,
    resize: { mode: 'longest', value: p.longestSide, upscale: false },
    format: p.format,
    quality: p.quality,
    metadata: p.metadata,
    qualityGuard: true,
  };
}
