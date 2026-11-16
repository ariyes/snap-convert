import { describe, expect, it } from 'vitest';
import {
  avifOptions,
  avifQuality,
  avifSpeed,
  chooseChroma,
  clampQuality,
  jpegOptions,
  pngOptions,
  webpOptions,
  webpQuality,
} from './options';

describe('clampQuality', () => {
  it('rounds and clamps to 1–100, defaulting to 80', () => {
    expect([clampQuality(0), clampQuality(55.4), clampQuality(400), clampQuality(NaN)]).toEqual([
      1, 55, 100, 80,
    ]);
  });
});

describe('chooseChroma (D24)', () => {
  it('uses 4:2:0 for photos below quality 90', () => {
    expect(chooseChroma(80, false)).toBe('4:2:0');
    expect(chooseChroma(89, false)).toBe('4:2:0');
  });
  it('uses 4:4:4 for graphics at any quality, and for everything at 90+', () => {
    expect(chooseChroma(40, true)).toBe('4:4:4');
    expect(chooseChroma(90, false)).toBe('4:4:4');
  });
});

describe('jpegOptions', () => {
  it('is progressive mozjpeg with trellis and optimised Huffman by default', () => {
    expect(jpegOptions(80, '4:2:0')).toMatchObject({
      quality: 80,
      progressive: true,
      baseline: false,
      optimize_coding: true,
      trellis_multipass: true,
      arithmetic: false,
    });
    expect(jpegOptions(80, '4:2:0', false).progressive).toBe(false);
  });
  it('sets the sampling explicitly instead of letting the codec pick', () => {
    expect(jpegOptions(80, '4:4:4')).toMatchObject({ auto_subsample: false, chroma_subsample: 1 });
    expect(jpegOptions(80, '4:2:0')).toMatchObject({ auto_subsample: false, chroma_subsample: 2 });
  });
});

describe('webp', () => {
  it('turns on sharp YUV and keeps alpha at full quality', () => {
    expect(webpOptions(80)).toMatchObject({ use_sharp_yuv: 1, alpha_quality: 100, lossless: 0 });
  });
  it('lifts mid/high quality by up to 5 so WebP is never softer than the same JPEG setting', () => {
    expect([
      webpQuality(1),
      webpQuality(40),
      webpQuality(60),
      webpQuality(80),
      webpQuality(100),
    ]).toEqual([1, 40, 63, 85, 100]);
  });
});

describe('avif', () => {
  it('maps app quality onto libavif’s scale, monotonically', () => {
    expect(avifQuality(80)).toBe(74);
    expect(avifQuality(100)).toBe(90);
    for (let q = 2; q <= 100; q++)
      expect(avifQuality(q)).toBeGreaterThanOrEqual(avifQuality(q - 1));
  });
  it('picks a faster speed for bigger images so 12 MP stays well under 15 s', () => {
    expect(avifSpeed(2e6, false)).toBe(6);
    expect(avifSpeed(12e6, false)).toBe(7);
    expect(avifSpeed(8e6, true)).toBe(6);
    expect(avifSpeed(40e6, true)).toBe(8);
  });
  it('uses 4:4:4 for graphics and sharp YUV for 4:2:0', () => {
    expect(avifOptions(80, '4:4:4', 1e6, false)).toMatchObject({
      subsample: 3,
      enableSharpYUV: false,
    });
    expect(avifOptions(80, '4:2:0', 1e6, false)).toMatchObject({
      subsample: 1,
      enableSharpYUV: true,
      bitDepth: 8,
    });
  });
});

describe('png', () => {
  it('is oxipng level 2, without touching hidden colour under transparent pixels', () => {
    expect(pngOptions).toEqual({ level: 2, interlace: false, optimiseAlpha: false });
  });
});
