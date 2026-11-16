import { describe, expect, it } from 'vitest';
import { readContainer, sniffFormat } from './container';
import { cameraName, exifDateToIso } from './metadata';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const size = 16 + 4 * compatible.length;
  return new Uint8Array([0, 0, 0, size, ...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)]);
}

describe('sniffFormat', () => {
  it.each([
    [[0xff, 0xd8, 0xff, 0xe0], 'jpeg'],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'png'],
    [ascii('GIF89a'), 'gif'],
    [ascii('GIF87a'), 'gif'],
    [[...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')], 'webp'],
    [[...ascii('BM'), ...new Array<number>(12).fill(0), 40, 0, 0, 0, ...new Array<number>(10).fill(0)], 'bmp'],
    [ascii('hello world'), 'unknown'],
    [[...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')], 'unknown'],
  ] as const)('%j → %s', (bytes, format) => {
    expect(sniffFormat(new Uint8Array(bytes))).toBe(format);
  });

  it('tells AVIF from HEIC by the ftyp brands', () => {
    expect(sniffFormat(ftyp('heic', 'mif1', 'heic'))).toBe('heic');
    expect(sniffFormat(ftyp('avif', 'mif1', 'avif'))).toBe('avif');
    expect(sniffFormat(ftyp('mif1', 'mif1', 'avif'))).toBe('avif');
    expect(sniffFormat(ftyp('mif1', 'mif1', 'heic'))).toBe('heic');
    expect(sniffFormat(ftyp('isom', 'mp41'))).toBe('unknown'); // a video, not an image
  });
});

describe('readContainer', () => {
  it('joins multi-segment JPEG ICC profiles in sequence order', async () => {
    const app2 = (seq: number, payload: number[]) => {
      const body = [...ascii('ICC_PROFILE'), 0, seq, 2, ...payload];
      return [0xff, 0xe2, 0, body.length + 2, ...body];
    };
    const sof = [0xff, 0xc0, 0, 11, 8, 0, 30, 0, 40, 1, 1, 0x11, 0];
    const jpeg = new Uint8Array([0xff, 0xd8, ...app2(2, [3, 4]), ...app2(1, [1, 2]), ...sof, 0xff, 0xda]);
    const info = await readContainer(jpeg);
    expect(info).toMatchObject({ format: 'jpeg', width: 40, height: 30 });
    expect(Array.from(info.icc ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('reads lossless WebP (VP8L) dimensions and an EXIF chunk with an "Exif" prefix', async () => {
    const bits = (300 - 1) | ((200 - 1) << 14);
    const vp8l = [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff];
    const exif = [...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 42, 0, 0, 0, 8];
    const webp = new Uint8Array([
      ...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'),
      ...ascii('VP8L'), vp8l.length, 0, 0, 0, ...vp8l, 0, // padded to even
      ...ascii('EXIF'), exif.length, 0, 0, 0, ...exif,
    ]);
    const info = await readContainer(webp);
    expect(info).toMatchObject({ format: 'webp', width: 300, height: 200 });
    expect(String.fromCharCode(...(info.exif ?? []).slice(0, 2))).toBe('MM');
  });

  it('never throws on garbage after a valid signature', async () => {
    const junk = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]);
    await expect(readContainer(junk)).resolves.toMatchObject({ format: 'jpeg' });
  });
});

describe('metadata helpers', () => {
  it('builds camera names without repeating the make', () => {
    expect(cameraName('Canon', 'Canon EOS R5')).toBe('Canon EOS R5');
    expect(cameraName('Apple', 'iPhone 7')).toBe('Apple iPhone 7');
    expect(cameraName('NIKON CORPORATION', 'NIKON D750')).toBe('NIKON D750');
    expect(cameraName(undefined, 'X100')).toBe('X100');
    expect(cameraName(undefined, undefined)).toBeUndefined();
  });

  it('turns EXIF dates into ISO strings without inventing a time zone', () => {
    expect(exifDateToIso('2019:03:21 11:04:22')).toBe('2019-03-21T11:04:22');
    expect(exifDateToIso('2019:03:21 11:04:22', '-05:00')).toBe('2019-03-21T11:04:22-05:00');
    expect(exifDateToIso('0000:00:00 00:00:00')).toBeUndefined();
    expect(exifDateToIso('not a date')).toBeUndefined();
    expect(exifDateToIso(42)).toBeUndefined();
  });
});
