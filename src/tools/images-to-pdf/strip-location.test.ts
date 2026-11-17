import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exifToTiff, parseJpeg, readExifInfo } from '@/engines/image/metadata';
import {
  ascii,
  buildExifTiff,
  buildJpeg,
  commentSegment,
  exifSegment,
  indexOf,
  latitudeBytes,
  xmpSegment,
} from '@/engines/image/metadata/testing/builders';
import { stripLocation } from './strip-location';

const APP1 = 0xe1;

async function bytesOf(blob: Blob | null): Promise<Uint8Array<ArrayBuffer>> {
  if (!blob) throw new Error('expected a JPEG');
  return new Uint8Array(await blob.arrayBuffer());
}

/** EXIF info of a JPEG's first APP1 EXIF segment, or null when it has none. */
function exifInfo(jpeg: Uint8Array) {
  const seg = parseJpeg(jpeg).segments.find(
    (s) => s.marker === APP1 && indexOf(s.data.subarray(0, 6), ascii('Exif\0\0')) === 0,
  );
  return seg ? readExifInfo(exifToTiff(seg.data)) : null;
}

const scanOf = (jpeg: Uint8Array) => parseJpeg(jpeg).scan;

describe('stripLocation', () => {
  it.each([true, false])(
    'removes GPS, XMP and comments but keeps orientation 6 and the image data (little-endian %s)',
    async (littleEndian) => {
      const tiff = buildExifTiff({ littleEndian, orientation: 6, gps: true, thumbnail: true });
      const input = buildJpeg([exifSegment(tiff), xmpSegment(), commentSegment('Home')]);
      expect(indexOf(input, latitudeBytes(littleEndian))).toBeGreaterThan(0);

      const out = await bytesOf(await stripLocation(new Blob([input])));

      expect(indexOf(out, latitudeBytes(littleEndian))).toBe(-1);
      expect(indexOf(out, ascii('GPSLatitude'))).toBe(-1);
      expect(indexOf(out, ascii('Home'))).toBe(-1);
      expect(exifInfo(out)).toMatchObject({ orientation: 6, hasGps: false });
      // No re-encode: the compressed image data is byte-for-byte the same.
      expect(scanOf(out)).toEqual(scanOf(input));
    },
  );

  it('keeps orientation 1 and files without EXIF as they are (apart from metadata)', async () => {
    const upright = buildJpeg([exifSegment(buildExifTiff({ orientation: 1, gps: true }))]);
    const out = await bytesOf(await stripLocation(new Blob([upright])));
    expect(exifInfo(out)).toMatchObject({ orientation: 1, hasGps: false });

    const plain = buildJpeg();
    expect(await bytesOf(await stripLocation(new Blob([plain])))).toEqual(plain);
  });

  it('still says how the image is turned when the rest of its EXIF had to go', async () => {
    // GPS directory pointing outside the block: the EXIF can't be kept, so it's dropped whole…
    const tiff = buildExifTiff({ orientation: 8, gps: true });
    const info = readExifInfo(exifToTiff(tiff));
    expect(info.hasGps).toBe(true);
    const view = new DataView(tiff.buffer);
    const ifd0 = view.getUint32(4, true);
    const count = view.getUint16(ifd0, true);
    for (let i = 0; i < count; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (view.getUint16(entry, true) === 0x8825) view.setUint32(entry + 8, 0xfff0, true);
    }
    const input = buildJpeg([exifSegment(tiff)]);

    const out = await bytesOf(await stripLocation(new Blob([input])));
    // …and an orientation-only block takes its place, so the PDF page is still upright.
    expect(exifInfo(out)).toEqual({
      orientation: 8,
      hasGps: false,
      hasThumbnail: false,
      ifd0Tags: [0x0112],
    });
    expect(indexOf(out, ascii('TestCam'))).toBe(-1);
    expect(scanOf(out)).toEqual(scanOf(input));
  });

  it('returns null for a JPEG whose header it cannot read safely', async () => {
    const broken = buildJpeg().subarray(0, 30);
    expect(await stripLocation(new Blob([broken]))).toBeNull();
  });

  it('removes the location from the gps.jpg fixture', async () => {
    const file = new Uint8Array(readFileSync(path.resolve('tests/fixtures/images/gps.jpg')));
    expect(exifInfo(file)?.hasGps).toBe(true);
    const out = await bytesOf(await stripLocation(new Blob([file])));
    expect(exifInfo(out)).toMatchObject({ orientation: 1, hasGps: false });
    expect(scanOf(out)).toEqual(scanOf(file));
  });
});
