import { describe, expect, it } from 'vitest';
import { parseSettings } from '@/features/settings';
import {
  defaultSettings,
  localePageSize,
  regionOf,
  settingsSchema,
  toPdfPageOptions,
} from './settings';

describe('localePageSize', () => {
  it('uses Letter for US and Canada locales', () => {
    expect(localePageSize(['en-US'])).toBe('letter');
    expect(localePageSize(['fr-CA'])).toBe('letter');
    expect(localePageSize(['en-CA', 'en-GB'])).toBe('letter');
  });

  it('uses A4 everywhere else', () => {
    expect(localePageSize(['en-GB'])).toBe('a4');
    expect(localePageSize(['de-DE'])).toBe('a4');
    expect(localePageSize(['fr'])).toBe('a4');
    expect(localePageSize(['es-MX'])).toBe('a4');
  });

  it('falls back to A4 when the locale is missing or broken', () => {
    expect(localePageSize([])).toBe('a4');
    expect(localePageSize(['not a locale!!'])).toBe('a4');
    expect(regionOf('')).toBeUndefined();
  });

  it('reads a language without a region by its likely region', () => {
    expect(regionOf('en')).toBe('US');
    expect(regionOf('de')).toBe('DE');
  });
});

describe('settings', () => {
  it('defaults: locale page size, Auto, no margin, Original', () => {
    expect(defaultSettings(['en-GB'])).toEqual({
      pageSize: 'a4',
      orientation: 'auto',
      margin: 'none',
      quality: 'original',
    });
  });

  it('ignores stored values that are not allowed', () => {
    const stored = JSON.stringify({ pageSize: 'a3', orientation: 'landscape', margin: 7 });
    expect(parseSettings(stored, defaultSettings(['en-US']), settingsSchema)).toEqual({
      pageSize: 'letter',
      orientation: 'landscape',
      margin: 'none',
      quality: 'original',
    });
  });

  it('maps margins to millimetres for the PDF job', () => {
    const base = defaultSettings(['en-GB']);
    expect(toPdfPageOptions(base)).toEqual({ pageSize: 'a4', orientation: 'auto', marginMm: 0 });
    expect(toPdfPageOptions({ ...base, margin: 'small' }).marginMm).toBe(10);
    expect(toPdfPageOptions({ ...base, margin: 'large', pageSize: 'fit-image' })).toEqual({
      pageSize: 'fit-image',
      orientation: 'auto',
      marginMm: 20,
    });
  });
});
