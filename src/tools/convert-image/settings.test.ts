import { describe, expect, it } from 'vitest';
import { parseSettings } from '@/features/settings';
import { formatPages } from '@/tools/registry';
import {
  CONVERT_DEFAULTS,
  CONVERT_FORMATS,
  convertJobOptions,
  convertSettingsSchema,
  type ConvertToolSettings,
} from './settings';

const settings = (patch: Partial<ConvertToolSettings> = {}): ConvertToolSettings => ({
  ...CONVERT_DEFAULTS,
  ...patch,
});

describe('Convert defaults', () => {
  it('save as JPG at quality 85 on white, without resizing', () => {
    expect(CONVERT_DEFAULTS).toMatchObject({
      format: 'jpeg',
      quality: 85,
      background: '#ffffff',
      resizeEnabled: false,
      upscale: false,
    });
    expect(CONVERT_FORMATS).toEqual(['jpeg', 'png', 'webp', 'avif']);
  });

  it('cover every format page target', () => {
    for (const page of formatPages) expect(CONVERT_FORMATS).toContain(page.to);
  });
});

describe('convertJobOptions', () => {
  it('converts at full size with the background colour', () => {
    expect(convertJobOptions(settings({ background: '#000000' }))).toEqual({
      format: 'jpeg',
      quality: 85,
      targetBytes: undefined,
      metadata: 'strip-all',
      background: '#000000',
      qualityGuard: true,
    });
  });

  it('resizes only with "Also resize" on', () => {
    expect(
      convertJobOptions(settings({ resizeEnabled: true, resizeMode: 'width', resizeSize: 800 })),
    ).toMatchObject({ resize: { mode: 'width', value: 800, upscale: false } });
  });

  it('turns the quality guard off once the user picks a quality (D28)', () => {
    expect(convertJobOptions(settings({ format: 'webp', quality: 60 }))).toMatchObject({
      format: 'webp',
      quality: 60,
      qualityGuard: false,
    });
  });
});

describe('stored Convert settings', () => {
  it('never come back as "Same as original" or a bad colour', () => {
    const stored = JSON.stringify({ format: 'keep', background: 'red', resizeMode: 'exact' });
    expect(parseSettings(stored, CONVERT_DEFAULTS, convertSettingsSchema)).toMatchObject({
      format: 'jpeg',
      background: '#ffffff',
      resizeMode: 'longest',
    });
    const ok = JSON.stringify({ format: 'avif', background: '#12abEF' });
    expect(parseSettings(ok, CONVERT_DEFAULTS, convertSettingsSchema)).toMatchObject({
      format: 'avif',
      background: '#12abEF',
    });
  });
});
