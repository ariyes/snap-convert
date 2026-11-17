import { describe, expect, it } from 'vitest';
import { parseSettings } from '@/features/settings';
import { HEIC_DEFAULTS, HEIC_FORMATS, heicJobOptions, heicSettingsSchema } from './settings';

describe('HEIC to JPG', () => {
  it('defaults to JPG at quality 90 with the location removed', () => {
    expect(HEIC_DEFAULTS).toMatchObject({
      format: 'jpeg',
      quality: 90,
      metadata: 'strip-location',
    });
    expect(HEIC_FORMATS).toEqual(['jpeg', 'png']);
  });

  it('converts at full size, guarded at the default quality', () => {
    expect(heicJobOptions(HEIC_DEFAULTS)).toEqual({
      format: 'jpeg',
      quality: 90,
      targetBytes: undefined,
      metadata: 'strip-location',
      resize: undefined,
      exact: undefined,
      qualityGuard: true,
    });
    expect(heicJobOptions({ ...HEIC_DEFAULTS, resizeEnabled: true }).resize).toBeUndefined();
    expect(heicJobOptions({ ...HEIC_DEFAULTS, quality: 75 }).qualityGuard).toBe(false);
  });

  it('only remembers JPG or PNG', () => {
    const stored = JSON.stringify({ format: 'webp', metadata: 'keep-all' });
    expect(parseSettings(stored, HEIC_DEFAULTS, heicSettingsSchema)).toMatchObject({
      format: 'jpeg',
      metadata: 'keep-all',
    });
  });
});
