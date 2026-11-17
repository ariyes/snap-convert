import { describe, expect, it } from 'vitest';
import { getPreset } from '@/engines/optimize';
import { clearPresetOnChange, IMAGE_SETTINGS_DEFAULTS } from '@/features/image-settings';
import {
  COMPRESS_DEFAULTS,
  COMPRESS_PRESETS,
  jobInput,
  jobOptions,
  optionsKey,
  presetPatch,
  recommendedSide,
  withQualityFlag,
  type CompressSettings,
} from './settings';

const apply = (base: CompressSettings, patch: Partial<CompressSettings>) => ({ ...base, ...patch });

describe('Compress defaults (IMG-04)', () => {
  it('quality 80, same format, resizing off, details removed, guard on', () => {
    expect(COMPRESS_DEFAULTS).toMatchObject({
      qualityMode: 'quality',
      quality: 80,
      format: 'keep',
      resizeEnabled: false,
      metadata: 'strip-all',
      upscale: false,
      preset: null,
      qualitySet: false,
    });
    expect(jobOptions(COMPRESS_DEFAULTS)).toEqual({
      format: 'keep',
      quality: 80,
      targetBytes: undefined,
      metadata: 'strip-all',
      qualityGuard: true,
    });
  });

  it('offers the prototype chips: WordPress, Shopify, Blog hero, Email, Thumbnail', () => {
    expect(COMPRESS_PRESETS.map((p) => p.id)).toEqual([
      'wordpress',
      'shopify',
      'blog',
      'email',
      'thumbnail',
    ]);
  });
});

describe('presets (IMG-06)', () => {
  it.each(COMPRESS_PRESETS.map((p) => [p.id, p] as const))(
    '%s sets size, format, quality and metadata',
    (_id, preset) => {
      const custom = apply(COMPRESS_DEFAULTS, {
        quality: 55,
        qualitySet: true,
        format: 'png',
        metadata: 'keep-all',
      });
      const next = apply(custom, presetPatch(preset));
      expect(next).toMatchObject({
        preset: preset.id,
        qualityMode: 'quality',
        quality: preset.quality,
        format: preset.format,
        metadata: preset.metadata,
        resizeEnabled: true,
        resizeMode: 'longest',
        resizeSize: preset.longestSide,
        qualitySet: false,
      });
      expect(jobOptions(next)).toEqual({
        resize: { mode: 'longest', value: preset.longestSide, upscale: false },
        format: 'jpeg',
        quality: 80,
        targetBytes: undefined,
        metadata: 'strip-all',
        qualityGuard: true,
      });
    },
  );

  it('a manual change clears the chip; moving quality also turns the guard off', () => {
    let s: CompressSettings = apply(COMPRESS_DEFAULTS, presetPatch(getPreset('wordpress')));
    const change = clearPresetOnChange<CompressSettings>((patch) => {
      s = apply(s, withQualityFlag(patch));
    });
    change({ format: 'webp' });
    expect(s.preset).toBeNull();
    expect(jobOptions(s).qualityGuard).toBe(true);

    s = apply(s, presetPatch(getPreset('blog')));
    change({ quality: 70 });
    expect(s).toMatchObject({ preset: null, quality: 70, qualitySet: true });
    expect(jobOptions(s).qualityGuard).toBe(false);
  });

  it('recommends a minimum size only for a selected preset', () => {
    expect(recommendedSide(COMPRESS_DEFAULTS)).toBeUndefined();
    expect(recommendedSide({ preset: 'blog' })).toBe(1200);
  });
});

describe('job options', () => {
  it('resizes only when "Also resize" is on', () => {
    const off = apply(COMPRESS_DEFAULTS, { resizeMode: 'width', resizeSize: 800 });
    expect(jobOptions(off).resize).toBeUndefined();
    const on = apply(off, { resizeEnabled: true });
    expect(jobOptions(on).resize).toEqual({ mode: 'width', value: 800, upscale: false });
    const percent = apply(on, { resizeMode: 'percent', resizePercent: 25 });
    expect(jobOptions(percent).resize).toEqual({ mode: 'percent', value: 25, upscale: false });
  });

  it('target mode asks for bytes', () => {
    const s = apply(COMPRESS_DEFAULTS, { qualityMode: 'target', targetKb: 100 });
    expect(jobOptions(s).targetBytes).toBe(100 * 1024);
  });

  it('gives equal keys for equal options and different keys otherwise', () => {
    const a = optionsKey(jobOptions(COMPRESS_DEFAULTS));
    expect(optionsKey(jobOptions({ ...COMPRESS_DEFAULTS }))).toBe(a);
    // A preset id alone doesn't change the result.
    expect(optionsKey(jobOptions(apply(COMPRESS_DEFAULTS, { rename: 'x' })))).toBe(a);
    expect(optionsKey(jobOptions(apply(COMPRESS_DEFAULTS, { quality: 81 })))).not.toBe(a);
    expect(optionsKey(jobOptions(apply(COMPRESS_DEFAULTS, { metadata: 'keep-all' })))).not.toBe(a);
    const resized = apply(COMPRESS_DEFAULTS, { resizeEnabled: true });
    expect(optionsKey(jobOptions(apply(resized, { resizeSize: 1000 })))).not.toBe(
      optionsKey(jobOptions(resized)),
    );
  });

  it('passes the file, its name and intake size to the job', () => {
    const file = new File(['x'], 'IMG_1.jpg', { type: 'image/jpeg' });
    const input = jobInput(
      { id: '1', file, name: 'IMG_1.jpg', size: 1, kind: 'image', width: 4032, height: 3024 },
      jobOptions(COMPRESS_DEFAULTS),
    );
    expect(input).toMatchObject({ file, name: 'IMG_1.jpg', width: 4032, height: 3024 });
  });

  it('starts from the shared image defaults', () => {
    expect(COMPRESS_DEFAULTS.targetKb).toBe(IMAGE_SETTINGS_DEFAULTS.targetKb);
  });
});
