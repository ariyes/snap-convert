import { describe, expect, it } from 'vitest';
import type { ImageJobInput } from '@/core/contracts/image';
import {
  canKeepOriginal,
  chooseFormat,
  decodeHint,
  isImageJobInput,
  outputName,
  padColour,
} from './pipeline';

const base: ImageJobInput = {
  file: new Blob([]),
  name: 'a.jpg',
  format: 'jpeg',
  quality: 80,
  metadata: 'strip-all',
};

describe('chooseFormat', () => {
  it('keeps JPEG, PNG, WebP and AVIF; anything else becomes JPEG', () => {
    for (const f of ['jpeg', 'png', 'webp', 'avif'] as const) {
      expect(chooseFormat('keep', f)).toEqual({ format: f, fallback: false });
    }
    for (const f of ['heic', 'gif', 'bmp', 'unknown'] as const) {
      expect(chooseFormat('keep', f)).toEqual({ format: 'jpeg', fallback: true });
    }
    expect(chooseFormat('webp', 'heic')).toEqual({ format: 'webp', fallback: false });
  });
});

describe('outputName', () => {
  it('swaps the extension', () => {
    expect(outputName('IMG_1.HEIC', 'jpeg')).toBe('IMG_1.jpg');
    expect(outputName('my.photo.png', 'webp')).toBe('my.photo.webp');
    expect(outputName('noext', 'avif')).toBe('noext.avif');
    expect(outputName('', 'png')).toBe('image.png');
  });
});

describe('decodeHint', () => {
  it('longest side and fit boxes give the hint directly', () => {
    expect(decodeHint({ ...base, resize: { mode: 'longest', value: 1920 } })).toEqual({
      minLongestSide: 1920,
    });
    expect(decodeHint({ ...base, exact: { width: 1200, height: 800, fit: 'fit' } })).toEqual({
      minLongestSide: 1200,
    });
  });

  it('other modes need the source size, and allow for either orientation', () => {
    expect(decodeHint({ ...base, resize: { mode: 'width', value: 1000 } })).toBeUndefined();
    const hint = decodeHint({
      ...base,
      resize: { mode: 'width', value: 1000 },
      width: 8000,
      height: 6000,
    });
    // Landscape: 1000×750. Portrait (if EXIF rotates it): 1000×1333.
    expect(hint).toEqual({ minLongestSide: 1333 });
    const fill = decodeHint({
      ...base,
      exact: { width: 1000, height: 1000, fit: 'fill' },
      width: 8000,
      height: 4000,
    });
    expect(fill?.minLongestSide).toBeGreaterThanOrEqual(2000); // covers the box: 2000×1000 before crop
  });

  it('no resize, or bad settings: no hint', () => {
    expect(decodeHint(base)).toBeUndefined();
    expect(decodeHint({ ...base, resize: { mode: 'none', value: 0 } })).toBeUndefined();
    expect(
      decodeHint({ ...base, resize: { mode: 'percent', value: -5 }, width: 10, height: 10 }),
    ).toBeUndefined();
  });
});

describe('padColour', () => {
  it('parses colours, transparent, and defaults to white', () => {
    expect(padColour(undefined)).toEqual([255, 255, 255, 255]);
    expect(padColour('transparent')).toEqual([0, 0, 0, 0]);
    expect(padColour('#ff0000')).toEqual([255, 0, 0, 255]);
  });
});

describe('canKeepOriginal (D30)', () => {
  const clean = { orientation: 1, hasLocation: false };
  const ready = { untouched: true, sourceFormat: 'jpeg' as const, metadata: clean };

  it('JPEG with untouched pixels in the same format qualifies under any policy', () => {
    for (const policy of ['strip-all', 'keep-all', 'strip-location'] as const) {
      expect(canKeepOriginal(ready, 'jpeg', policy)).toBe(true);
    }
  });

  it('not when resized, converted, rotated by EXIF, or in a non-sRGB colour profile', () => {
    expect(canKeepOriginal({ ...ready, untouched: false }, 'jpeg', 'strip-all')).toBe(false);
    expect(canKeepOriginal(ready, 'webp', 'strip-all')).toBe(false);
    const rotated = { ...ready, metadata: { ...clean, orientation: 6 } };
    expect(canKeepOriginal(rotated, 'jpeg', 'strip-all')).toBe(false);
    const p3 = { ...ready, metadata: { ...clean, iccProfile: new ArrayBuffer(200) } };
    expect(canKeepOriginal(p3, 'jpeg', 'keep-all')).toBe(false);
  });

  it('other formats only when the policy has nothing to remove', () => {
    const png = { ...ready, sourceFormat: 'png' as const };
    expect(canKeepOriginal(png, 'png', 'strip-all')).toBe(true);
    const withExif = { ...png, metadata: { ...clean, exif: new ArrayBuffer(8) } };
    expect(canKeepOriginal(withExif, 'png', 'strip-all')).toBe(false);
    expect(canKeepOriginal(withExif, 'png', 'keep-all')).toBe(true);
    const withGps = { ...png, metadata: { ...clean, exif: new ArrayBuffer(8), hasLocation: true } };
    expect(canKeepOriginal(withGps, 'png', 'strip-location')).toBe(false);
    expect(canKeepOriginal(withExif, 'png', 'strip-location')).toBe(true);
  });
});

describe('isImageJobInput', () => {
  it('accepts a valid job and rejects broken ones', () => {
    expect(isImageJobInput(base)).toBe(true);
    expect(isImageJobInput({ ...base, resize: { mode: 'longest', value: 10 } })).toBe(true);
    expect(isImageJobInput({ ...base, qualityGuard: true, background: '#000' })).toBe(true);
    expect(isImageJobInput(null)).toBe(false);
    expect(isImageJobInput({ ...base, file: 'nope' })).toBe(false);
    expect(isImageJobInput({ ...base, format: 'gif' })).toBe(false);
    expect(isImageJobInput({ ...base, metadata: 'all' })).toBe(false);
    expect(isImageJobInput({ ...base, exact: { width: 1 } })).toBe(false);
  });
});
