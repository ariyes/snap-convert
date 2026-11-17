import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '@/features/settings';
import {
  AUTO_QUALITY,
  formatExposure,
  jobInput,
  jobOptions,
  RAW_DEFAULTS,
  RAW_SCHEMA,
  rawOptions,
  settingsSignature,
  type RawToJpgSettings,
} from './settings';

const s = (patch: Partial<RawToJpgSettings> = {}): RawToJpgSettings => ({
  ...RAW_DEFAULTS,
  ...patch,
});

describe('defaults', () => {
  it('fast mode, JPG with the quality guard, full size, camera details kept, location removed', () => {
    expect(RAW_DEFAULTS).toMatchObject({
      mode: 'fast',
      whiteBalance: 'as-shot',
      exposure: 0,
      highlights: 'clip',
      format: 'jpeg',
      qualityMode: 'auto',
      resizeEnabled: false,
      upscale: false,
      metadata: 'strip-location',
      rename: '{name}',
    });
  });

  it('turns into a full-size fast-mode job', () => {
    expect(jobOptions(RAW_DEFAULTS)).toEqual({
      format: 'jpeg',
      quality: AUTO_QUALITY,
      metadata: 'strip-location',
      qualityGuard: true,
      raw: { mode: 'fast', whiteBalance: 'as-shot', exposure: 0, highlights: 'clip' },
    });
  });
});

describe('settings → job input', () => {
  it('full quality passes the develop settings', () => {
    const options = jobOptions(
      s({ mode: 'full', whiteBalance: 'auto', exposure: 1, highlights: 'recover' }),
    );
    expect(options.raw).toEqual({
      mode: 'full',
      whiteBalance: 'auto',
      exposure: 1,
      highlights: 'recover',
    });
  });

  it('fast mode ignores the develop settings (they are hidden and change nothing)', () => {
    const fast = s({ whiteBalance: 'auto', exposure: 1.5, highlights: 'recover' });
    expect(rawOptions(fast)).toEqual(rawOptions(RAW_DEFAULTS));
    expect(settingsSignature(fast)).toBe(settingsSignature(RAW_DEFAULTS));
  });

  it('keeps exposure within −2…+2 in half stops', () => {
    expect(rawOptions(s({ mode: 'full', exposure: 3 })).exposure).toBe(2);
    expect(rawOptions(s({ mode: 'full', exposure: -7 })).exposure).toBe(-2);
    expect(rawOptions(s({ mode: 'full', exposure: 0.7 })).exposure).toBe(0.5);
  });

  it('a quality the user chose turns the guard off (D28/D29)', () => {
    expect(jobOptions(s({ qualityMode: 'custom', quality: 70 }))).toMatchObject({
      quality: 70,
      qualityGuard: false,
    });
    expect(jobOptions(s({ qualityMode: 'auto', quality: 70 }))).toMatchObject({
      quality: AUTO_QUALITY,
      qualityGuard: true,
    });
  });

  it('resizes only when asked, from the sizing rule options, never enlarging by default', () => {
    expect(jobOptions(s({ resizeSize: 1600 })).resize).toBeUndefined();
    expect(jobOptions(s({ resizeEnabled: true, resizeSize: 1600 }))).toMatchObject({
      resize: { mode: 'longest', value: 1600, upscale: false },
    });
    expect(
      jobOptions(
        s({ resizeEnabled: true, resizeMode: 'exact', exactWidth: 1080, exactHeight: 1350 }),
      ).exact,
    ).toEqual({ width: 1080, height: 1350, fit: 'fit', upscale: false, padColor: '#ffffff' });
  });

  it('carries the format and metadata policy', () => {
    expect(jobOptions(s({ format: 'webp', metadata: 'strip-all' }))).toMatchObject({
      format: 'webp',
      metadata: 'strip-all',
    });
  });

  it('passes the size from readRawInfo so the queue runs 40 MP+ files alone (D27)', () => {
    const file = new File(['x'], 'IMG_1.CR3');
    expect(jobInput(RAW_DEFAULTS, file, { width: 9504, height: 6336 })).toMatchObject({
      file,
      name: 'IMG_1.CR3',
      width: 9504,
      height: 6336,
    });
    const unknown = jobInput(RAW_DEFAULTS, file, undefined);
    expect(unknown.width).toBeUndefined();
    expect(unknown.height).toBeUndefined();
  });

  it('a changed output setting makes earlier results stale; the name pattern does not', () => {
    const base = settingsSignature(RAW_DEFAULTS);
    expect(settingsSignature(s({ mode: 'full' }))).not.toBe(base);
    expect(settingsSignature(s({ format: 'png' }))).not.toBe(base);
    expect(settingsSignature(s({ rename: '{name}-{n}' }))).toBe(base);
  });
});

describe('stored settings', () => {
  it('drops values outside the controls', () => {
    const clean = sanitizeSettings(
      { ...RAW_DEFAULTS, mode: 'ultra', exposure: 0.3, format: 'keep', quality: 5 } as unknown,
      RAW_DEFAULTS,
      RAW_SCHEMA,
    );
    expect(clean).toMatchObject({
      mode: 'fast',
      exposure: 0,
      format: 'jpeg',
      quality: RAW_DEFAULTS.quality,
    });
    expect(
      sanitizeSettings({ ...RAW_DEFAULTS, exposure: -1.5 }, RAW_DEFAULTS, RAW_SCHEMA).exposure,
    ).toBe(-1.5);
  });
});

describe('formatExposure', () => {
  it('shows the sign and EV', () => {
    expect(formatExposure(0)).toBe('0 EV');
    expect(formatExposure(1)).toBe('+1 EV');
    expect(formatExposure(-0.5)).toBe('−0.5 EV');
  });
});
