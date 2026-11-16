import { describe, expect, it, vi } from 'vitest';
import type { WebPreset } from '@/core/contracts/image';
import { describe as describeSize, exactPlacement, fitSize } from '@/core/sizing';
import { sanitizeSettings } from '@/features/settings';
import { planSize } from './plan';
import {
  applyPreset,
  clearPresetOnChange,
  IMAGE_SETTINGS_DEFAULTS as D,
  imageSettingsSchema,
  toJobOptions,
  toJobSizing,
  type ImageSettingsValues,
} from './values';

const WORDPRESS: WebPreset = {
  id: 'wordpress',
  name: 'WordPress',
  longestSide: 2048,
  format: 'jpeg',
  quality: 80,
  metadata: 'strip-all',
};

describe('defaults', () => {
  it('never enlarges and strips private details by default', () => {
    expect(D.upscale).toBe(false);
    expect(D.metadata).toBe('strip-all');
    expect(D.quality).toBe(80);
    expect(D.preset).toBeNull();
  });
});

describe('applyPreset', () => {
  it('sets size, format, quality and metadata, and selects the preset', () => {
    expect(applyPreset(WORDPRESS)).toEqual({
      preset: 'wordpress',
      qualityMode: 'quality',
      quality: 80,
      format: 'jpeg',
      metadata: 'strip-all',
      resizeEnabled: true,
      resizeMode: 'longest',
      resizeSize: 2048,
    });
  });
});

describe('clearPresetOnChange', () => {
  it('clears the preset on any manual change', () => {
    const update = vi.fn();
    clearPresetOnChange<ImageSettingsValues>(update)({ quality: 70 });
    expect(update).toHaveBeenCalledWith({ quality: 70, preset: null });
  });

  it('keeps a patch that sets the preset itself', () => {
    const update = vi.fn();
    clearPresetOnChange<ImageSettingsValues>(update)(applyPreset(WORDPRESS));
    expect(update).toHaveBeenCalledWith(applyPreset(WORDPRESS));
  });
});

describe('toJobSizing', () => {
  it('maps pixel modes and percent to ResizeOptions', () => {
    expect(toJobSizing(D)).toEqual({ resize: { mode: 'longest', value: 1920, upscale: false } });
    expect(toJobSizing({ ...D, resizeMode: 'width', resizeSize: 800 })).toEqual({
      resize: { mode: 'width', value: 800, upscale: false },
    });
    expect(toJobSizing({ ...D, resizeMode: 'percent', resizePercent: 25 })).toEqual({
      resize: { mode: 'percent', value: 25, upscale: false },
    });
  });

  it('maps exact size to ExactOptions with the padding colour', () => {
    expect(
      toJobSizing({ ...D, resizeMode: 'exact', fit: 'fill', padColor: 'transparent' }),
    ).toEqual({
      exact: { width: 1080, height: 1080, fit: 'fill', upscale: false, padColor: 'transparent' },
    });
  });

  it("gives no resize for Don't resize, or when optional resizing is off", () => {
    expect(toJobSizing({ ...D, resizeMode: 'none' })).toEqual({});
    expect(toJobSizing({ ...D, resizeEnabled: false }, { optional: true })).toEqual({});
    // resizeEnabled only counts for tools with an "Also resize" checkbox
    expect(toJobSizing({ ...D, resizeEnabled: false })).not.toEqual({});
  });
});

describe('toJobOptions', () => {
  it('adds format, quality, metadata and the target size in bytes', () => {
    expect(toJobOptions({ ...D, qualityMode: 'target', targetKb: 150, format: 'webp' })).toEqual({
      resize: { mode: 'longest', value: 1920, upscale: false },
      format: 'webp',
      quality: 80,
      targetBytes: 150 * 1024,
      metadata: 'strip-all',
    });
    expect(toJobOptions(D).targetBytes).toBeUndefined();
  });
});

describe('imageSettingsSchema', () => {
  it('rejects stored values the controls cannot show', () => {
    const stored = {
      format: 'gif',
      quality: 0,
      resizeMode: 'stretch',
      padColor: 'red; background:url(x)',
      preset: 'myspace',
      metadata: 'keep-some',
      fit: 'stretch',
      rename: 'x'.repeat(500),
    };
    expect(sanitizeSettings(stored, { ...D }, imageSettingsSchema)).toEqual(D);
  });

  it('keeps valid stored values', () => {
    const stored = { format: 'avif', padColor: '#000000', preset: 'email', fit: 'fill' } as const;
    expect(sanitizeSettings(stored, { ...D }, imageSettingsSchema)).toEqual({ ...D, ...stored });
  });
});

describe('planSize', () => {
  const photo = { width: 4032, height: 3024 };

  it('takes the size and text from the sizing rule', () => {
    const plan = planSize(photo, D);
    const result = fitSize(photo, { mode: 'longest', value: 1920 });
    expect(plan?.output).toEqual({ width: result.width, height: result.height });
    expect(plan?.text).toBe(describeSize(photo, result));
    expect(plan?.text).toBe('4032×3024 → 1920×1440');
    expect(plan).toMatchObject({
      enlarged: false,
      notEnlarged: false,
      padded: false,
      cropped: false,
    });
  });

  it('says when a smaller image is not enlarged', () => {
    const plan = planSize({ width: 800, height: 600 }, D);
    expect(plan?.text).toBe('800×600 → 800×600');
    expect(plan?.notEnlarged).toBe(true);
  });

  it('enlarges only with upscale on', () => {
    const plan = planSize({ width: 800, height: 600 }, { ...D, upscale: true });
    expect(plan?.text).toBe('800×600 → 1920×1440');
    expect(plan).toMatchObject({ enlarged: true, notEnlarged: false });
  });

  it("keeps the size when resizing is off or Don't resize", () => {
    expect(planSize(photo, { ...D, resizeEnabled: false }, { optional: true })?.text).toBe(
      '4032×3024 → 4032×3024',
    );
    expect(planSize(photo, { ...D, resizeMode: 'none' })?.notEnlarged).toBe(false);
  });

  it('reports padded (fit) and cropped (fill) for exact sizes', () => {
    const fit = planSize(photo, { ...D, resizeMode: 'exact', fit: 'fit' });
    expect(fit?.text).toBe(
      describeSize(photo, exactPlacement(photo, { width: 1080, height: 1080, fit: 'fit' })),
    );
    expect(fit).toMatchObject({ padded: true, cropped: false });
    const fill = planSize(photo, { ...D, resizeMode: 'exact', fit: 'fill' });
    expect(fill).toMatchObject({ padded: false, cropped: true });
  });

  it('returns null for an invalid source size', () => {
    expect(planSize({ width: 0, height: 100 }, D)).toBeNull();
  });
});
