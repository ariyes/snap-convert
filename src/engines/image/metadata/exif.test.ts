import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../quality/testing/synthetic';
import { exifToTiff, ExifFormatError, prepareExif, readExifInfo, TAG } from './exif';
import {
  ascii,
  buildExifTiff,
  concat,
  indexOf,
  latitudeBytes,
  THUMBNAIL_FILL,
} from './testing/builders';

describe.each([true, false])('prepareExif (little-endian: %s)', (littleEndian) => {
  const build = () => buildExifTiff({ littleEndian, orientation: 6, gps: true, thumbnail: true });

  it('reads the test block as expected', () => {
    const info = readExifInfo(build());
    expect(info).toMatchObject({ orientation: 6, hasGps: true, hasThumbnail: true });
  });

  it('keep-all: orientation becomes 1, the stale thumbnail is removed, GPS stays', () => {
    const out = prepareExif(build(), { removeGps: false });
    const info = readExifInfo(out);
    expect(info.orientation).toBe(1);
    expect(info.hasThumbnail).toBe(false);
    expect(info.hasGps).toBe(true);
    expect(indexOf(out, new Uint8Array(16).fill(THUMBNAIL_FILL))).toBe(-1);
    expect(indexOf(out, ascii('TestCam Industries'))).toBeGreaterThan(0);
  });

  it('strip-location: the GPS directory is unlinked and its bytes wiped; everything else stays', () => {
    const before = build();
    expect(indexOf(before, latitudeBytes(littleEndian))).toBeGreaterThan(0);
    const out = prepareExif(build(), { removeGps: true });
    const info = readExifInfo(out);
    expect(info.hasGps).toBe(false);
    expect(info.ifd0Tags).not.toContain(TAG.gpsIfd);
    expect(info.ifd0Tags).toEqual(
      expect.arrayContaining([0x010f, 0x0110, TAG.orientation, TAG.exifIfd]),
    );
    expect(info.orientation).toBe(1);
    expect(indexOf(out, latitudeBytes(littleEndian))).toBe(-1);
    expect(indexOf(out, ascii('TestCam Industries'))).toBeGreaterThan(0);
    expect(indexOf(out, ascii('2026:11:16 10:20:30'))).toBeGreaterThan(0);
  });

  it('works without orientation, GPS or thumbnail', () => {
    const out = prepareExif(buildExifTiff({ littleEndian }), { removeGps: true });
    expect(readExifInfo(out)).toMatchObject({
      orientation: undefined,
      hasGps: false,
      hasThumbnail: false,
    });
  });
});

describe('exifToTiff', () => {
  it('accepts the APP1 payload with its "Exif\\0\\0" header, or bare TIFF', () => {
    const tiff = buildExifTiff({ orientation: 3 });
    expect(exifToTiff(concat(ascii('Exif\0\0'), tiff))).toEqual(tiff);
    expect(exifToTiff(tiff.buffer)).toEqual(tiff);
  });
});

describe('damaged EXIF', () => {
  it('rejects blocks that are not TIFF', () => {
    expect(() => prepareExif(ascii('hello world!'), { removeGps: true })).toThrow(ExifFormatError);
    expect(() => prepareExif(new Uint8Array(4), { removeGps: true })).toThrow(ExifFormatError);
  });

  it('rejects directories that loop back on themselves', () => {
    const tiff = buildExifTiff({ gps: true });
    const info = new DataView(tiff.buffer);
    // Point the Exif IFD link back at IFD0.
    const count = info.getUint16(8, true);
    for (let i = 0; i < count; i++) {
      const e = 10 + i * 12;
      if (info.getUint16(e, true) === TAG.exifIfd) info.setUint32(e + 8, 8, true);
    }
    expect(() => prepareExif(tiff, { removeGps: true })).toThrow(/loop/);
  });

  it('fuzz: 500 random corruptions each finish within 100 ms, editing or throwing ExifFormatError', () => {
    const original = buildExifTiff({ orientation: 8, gps: true, thumbnail: true });
    const rand = mulberry32(99);
    for (let round = 0; round < 500; round++) {
      const bytes = original.slice();
      for (let k = 0; k < 1 + rand() * 6; k++)
        bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
      const input = round % 5 === 0 ? bytes.slice(0, Math.floor(rand() * bytes.length)) : bytes;
      const t0 = performance.now();
      try {
        prepareExif(input, { removeGps: round % 2 === 0 });
      } catch (e) {
        expect(e).toBeInstanceOf(ExifFormatError);
      }
      expect(performance.now() - t0).toBeLessThan(100);
    }
  });
});
