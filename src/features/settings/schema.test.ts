import { describe, expect, it } from 'vitest';
import { numberIn, oneOf, parseSettings, sanitizeSettings } from './schema';

const defaults = {
  quality: 80,
  format: 'keep' as 'keep' | 'jpeg' | 'png',
  strip: true,
  preset: null as string | null,
  rename: '{name}',
  box: { width: 1080, height: 1080 },
  tags: ['a'],
};

describe('sanitizeSettings', () => {
  it('keeps valid stored values', () => {
    const stored = { ...defaults, quality: 60, strip: false, preset: 'wordpress', rename: 'x' };
    expect(sanitizeSettings(stored, defaults)).toEqual(stored);
  });

  it('drops unknown keys', () => {
    const out = sanitizeSettings({ quality: 70, evil: '<script>', __proto__x: 1 }, defaults);
    expect(out).toEqual({ ...defaults, quality: 70 });
    expect('evil' in out).toBe(false);
  });

  it('falls back key by key for values of the wrong type', () => {
    const out = sanitizeSettings(
      { quality: '90', strip: 'yes', rename: 5, format: 'png', box: 'big', tags: [1] },
      defaults,
    );
    expect(out).toEqual({ ...defaults, format: 'png' });
  });

  it('rejects numbers that are not finite', () => {
    expect(sanitizeSettings({ quality: null }, defaults).quality).toBe(80);
    expect(sanitizeSettings({ quality: Number.NaN }, defaults).quality).toBe(80);
  });

  it('lets a null default hold a simple value but not an object', () => {
    expect(sanitizeSettings({ preset: 'shopify' }, defaults).preset).toBe('shopify');
    expect(sanitizeSettings({ preset: { id: 1 } }, defaults).preset).toBeNull();
  });

  it('checks nested objects key by key', () => {
    const out = sanitizeSettings({ box: { width: 500, height: 'x', extra: 1 } }, defaults);
    expect(out.box).toEqual({ width: 500, height: 1080 });
  });

  it('uses the schema check when there is one', () => {
    const schema = { format: oneOf(['keep', 'jpeg', 'png'] as const), quality: numberIn(10, 100) };
    expect(sanitizeSettings({ format: 'gif', quality: 5 }, defaults, schema)).toEqual(defaults);
    expect(sanitizeSettings({ format: 'jpeg', quality: 55 }, defaults, schema)).toMatchObject({
      format: 'jpeg',
      quality: 55,
    });
  });

  it('gives the defaults for anything that is not an object', () => {
    for (const stored of [null, 42, 'text', [1, 2], true]) {
      expect(sanitizeSettings(stored, defaults)).toEqual(defaults);
    }
  });

  it('returns a copy, never the defaults object itself', () => {
    expect(sanitizeSettings(null, defaults)).not.toBe(defaults);
  });
});

describe('parseSettings', () => {
  it('gives the defaults for nothing stored or corrupt JSON', () => {
    expect(parseSettings(null, defaults)).toEqual(defaults);
    expect(parseSettings('{"quality": 7', defaults)).toEqual(defaults);
    expect(parseSettings('undefined', defaults)).toEqual(defaults);
  });

  it('parses and checks stored JSON', () => {
    expect(parseSettings('{"quality": 65, "format": 3}', defaults)).toEqual({
      ...defaults,
      quality: 65,
    });
  });
});
