import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { conversionFor, imageType, mayHaveAlpha } from './prepare';

const bytes = (file: string) => new Uint8Array(readFileSync(path.resolve('tests/fixtures', file)));

const fileOf = (name: string, width?: number, height?: number) => ({
  file: new File([new Uint8Array([1])], name),
  name,
  width,
  height,
});

describe('imageType', () => {
  it.each([
    ['images/no-exif.jpg', 'jpeg'],
    ['images/alpha.png', 'png'],
    ['images/sample.webp', 'webp'],
    ['images/sample.avif', 'avif'],
    ['images/iphone-7.heic', 'heic'],
    ['images/sample.gif', 'gif'],
    ['images/sample.bmp', 'bmp'],
    ['intake/jpeg-renamed.png', 'jpeg'],
    ['intake/text-renamed.jpg', 'unknown'],
  ])('%s → %s (from the bytes, not the name)', (file, type) => {
    expect(imageType(bytes(file))).toBe(type);
  });
});

describe('mayHaveAlpha', () => {
  it('reads the WebP alpha flags', () => {
    expect(mayHaveAlpha(bytes('intake/webp-alpha.webp'), 'webp')).toBe(true);
    expect(mayHaveAlpha(bytes('intake/webp-lossy.webp'), 'webp')).toBe(false);
    expect(mayHaveAlpha(bytes('images/sample.webp'), 'webp')).toBe(false);
  });

  it('finds no alpha plane in an opaque AVIF or an iPhone HEIC', () => {
    expect(mayHaveAlpha(bytes('images/sample.avif'), 'avif')).toBe(false);
    expect(mayHaveAlpha(bytes('images/iphone-7.heic'), 'heic')).toBe(false);
  });

  it('finds an AVIF / HEIF alpha plane by its URN', () => {
    const urn = new TextEncoder().encode('....auxCurn:mpeg:mpegB:cicp:systems:auxiliary:alpha\0');
    expect(mayHaveAlpha(urn, 'avif')).toBe(true);
    const hevc = new TextEncoder().encode('auxCurn:mpeg:hevc:2015:auxid:1\0');
    expect(mayHaveAlpha(hevc, 'heic')).toBe(true);
    // A depth map (auxid 2) is not transparency.
    expect(mayHaveAlpha(new TextEncoder().encode('urn:mpeg:hevc:2015:auxid:2\0'), 'heic')).toBe(
      false,
    );
  });

  it('reads a VP8L header bit', () => {
    const vp8l = new Uint8Array(30);
    vp8l.set(new TextEncoder().encode('RIFF'), 0);
    vp8l.set(new TextEncoder().encode('WEBPVP8L'), 8);
    vp8l[20] = 0x2f;
    expect(mayHaveAlpha(vp8l, 'webp')).toBe(false);
    vp8l[24] = 0x10;
    expect(mayHaveAlpha(vp8l, 'webp')).toBe(true);
  });
});

describe('conversionFor', () => {
  it('Original: JPEG and PNG go in as they are', () => {
    expect(conversionFor(fileOf('a.jpg'), bytes('images/no-exif.jpg'), 'original')).toBeNull();
    expect(conversionFor(fileOf('a.png'), bytes('images/alpha.png'), 'original')).toBeNull();
  });

  it('Original: HEIC, opaque WebP and AVIF become JPEG 92 (no quality guard)', () => {
    for (const file of ['images/iphone-7.heic', 'images/sample.webp', 'images/sample.avif']) {
      const job = conversionFor(fileOf('x', 4032, 3024), bytes(file), 'original');
      expect(job).toMatchObject({
        format: 'jpeg',
        quality: 92,
        qualityGuard: false,
        metadata: 'strip-all',
        width: 4032,
        height: 3024,
      });
      expect(job?.resize).toBeUndefined();
      expect(job?.exact).toBeUndefined();
    }
  });

  it('Original: transparent images, GIF and BMP become PNG', () => {
    for (const file of ['intake/webp-alpha.webp', 'images/sample.gif', 'images/sample.bmp']) {
      expect(conversionFor(fileOf('x'), bytes(file), 'original')?.format).toBe('png');
    }
  });

  it('Smaller file: every image → longest side 2480, JPEG 85, quality guard on', () => {
    for (const file of ['images/no-exif.jpg', 'images/alpha.png', 'images/iphone-7.heic']) {
      expect(conversionFor(fileOf('x', 100, 50), bytes(file), 'smaller')).toMatchObject({
        resize: { mode: 'longest', value: 2480, upscale: false },
        format: 'jpeg',
        quality: 85,
        qualityGuard: true,
        background: '#ffffff',
        width: 100,
        height: 50,
      });
    }
  });
});
