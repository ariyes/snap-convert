import { describe, expect, it } from 'vitest';
import { withQualityFlag } from '@/tools/_shared';
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
  });

  it('turns the quality guard off once the user moves the quality slider (D28/D29)', () => {
    const moved = { ...HEIC_DEFAULTS, ...withQualityFlag({ quality: 75 }) };
    expect(heicJobOptions(moved).qualityGuard).toBe(false);
    // Back at 90 by hand: still the user's choice, not inferred from "equals the default".
    const back = { ...moved, ...withQualityFlag({ quality: HEIC_DEFAULTS.quality }) };
    expect(heicJobOptions(back).qualityGuard).toBe(false);
    const png = { ...HEIC_DEFAULTS, ...withQualityFlag({ format: 'png' as const }) };
    expect(heicJobOptions(png).qualityGuard).toBe(true);
  });

  it('only remembers JPG or PNG', () => {
    const stored = JSON.stringify({ format: 'webp', metadata: 'keep-all' });
    expect(parseSettings(stored, HEIC_DEFAULTS, heicSettingsSchema)).toMatchObject({
      format: 'jpeg',
      metadata: 'keep-all',
    });
  });
});
