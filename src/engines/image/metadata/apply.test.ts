import { describe, expect, it } from 'vitest';
import type { ImageMetadata } from '@/core/contracts/image';
import { applyMetadata, applyMetadataDetailed } from './apply';
import { exifToTiff, readExifInfo } from './exif';
import { MARKER, parseJpeg, SIGNATURE, startsWith } from './jpeg-segments';
import { sniffFormat } from './sniff';
import {
  ascii,
  buildExifTiff,
  buildIcc,
  buildJpeg,
  commentSegment,
  concat,
  exifSegment,
  indexOf,
  latitudeBytes,
  xmpSegment,
} from './testing/builders';

const blob = (b: Uint8Array<ArrayBuffer>, type = 'image/jpeg') => new Blob([b], { type });
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** A JPEG as an encoder might hand it over, already carrying junk metadata to clean out. */
const dirtyJpeg = () =>
  buildJpeg([
    exifSegment(buildExifTiff({ gps: true })),
    xmpSegment(),
    commentSegment('made with something'),
    { marker: 0xed, data: ascii('Photoshop 3.0\0') },
  ]);

const meta = (o: Partial<ImageMetadata> = {}): ImageMetadata => ({
  orientation: 6,
  hasLocation: true,
  exif: concat(ascii('Exif\0\0'), buildExifTiff({ orientation: 6, gps: true, thumbnail: true }))
    .buffer,
  iccProfile: buildIcc('sRGB IEC61966-2.1').buffer,
  ...o,
});

function app1Exif(bytes: Uint8Array) {
  return parseJpeg(bytes).segments.filter(
    (s) => s.marker === MARKER.APP1 && startsWith(s.data, SIGNATURE.exif),
  );
}

describe('applyMetadata — JPEG', () => {
  it('strip-all: no EXIF, XMP, ICC, comments or other APPn left; JFIF kept', async () => {
    const out = await bytesOf(await applyMetadata(blob(dirtyJpeg()), meta(), 'strip-all'));
    const markers = parseJpeg(out).segments.map((s) => s.marker);
    expect(markers).toEqual([MARKER.APP0, 0xdb, 0xc0, 0xc4]);
    expect(indexOf(out, ascii('Exif'))).toBe(-1);
    expect(indexOf(out, ascii('http://ns.adobe.com/xap'))).toBe(-1);
    expect(indexOf(out, ascii('ICC_PROFILE'))).toBe(-1);
    expect(indexOf(out, ascii('made with'))).toBe(-1);
  });

  it('keep-all: writes the original EXIF (orientation 1, GPS kept) and the sRGB profile', async () => {
    const r = await applyMetadataDetailed(blob(dirtyJpeg()), meta(), 'keep-all');
    expect(r).toMatchObject({ jpegOnly: false, exifKept: true, iccKept: true, exifDropped: false });
    const out = await bytesOf(r.blob);
    const segs = parseJpeg(out).segments;
    expect(segs[0]?.marker).toBe(MARKER.APP0); // JFIF still first
    expect(segs[1]?.marker).toBe(MARKER.APP1);
    expect(segs[2]?.marker).toBe(MARKER.APP2);
    const exif = app1Exif(out);
    expect(exif).toHaveLength(1);
    const info = readExifInfo(exifToTiff(exif[0]!.data));
    expect(info).toMatchObject({ orientation: 1, hasGps: true, hasThumbnail: false });
    expect(indexOf(out, ascii('http://ns.adobe.com/xap'))).toBe(-1); // encoder junk still removed
    expect(r.blob.type).toBe('image/jpeg');
  });

  it('strip-location: EXIF present with orientation 1 but no GPS directory or coordinates', async () => {
    const out = await bytesOf(await applyMetadata(blob(dirtyJpeg()), meta(), 'strip-location'));
    const exif = app1Exif(out);
    expect(exif).toHaveLength(1);
    const info = readExifInfo(exifToTiff(exif[0]!.data));
    expect(info.hasGps).toBe(false);
    expect(info.orientation).toBe(1);
    expect(indexOf(out, latitudeBytes(true))).toBe(-1);
    expect(indexOf(out, ascii('TestCam Industries'))).toBeGreaterThan(0);
  });

  it('drops a non-sRGB colour profile (pixels were converted to sRGB at decode)', async () => {
    const r = await applyMetadataDetailed(
      blob(buildJpeg()),
      meta({ iccProfile: buildIcc('Display P3', 4).buffer }),
      'keep-all',
    );
    expect(r.iccKept).toBe(false);
    expect(indexOf(await bytesOf(r.blob), ascii('ICC_PROFILE'))).toBe(-1);
  });

  it('leaves damaged EXIF out instead of failing the file', async () => {
    const r = await applyMetadataDetailed(
      blob(buildJpeg()),
      meta({ exif: ascii('Exif\0\0garbage!').buffer }),
      'keep-all',
    );
    expect(r).toMatchObject({ exifKept: false, exifDropped: true });
    expect(app1Exif(await bytesOf(r.blob))).toHaveLength(0);
  });

  it('keep-all with no original metadata adds nothing', async () => {
    const r = await applyMetadataDetailed(
      blob(buildJpeg()),
      { orientation: 1, hasLocation: false },
      'keep-all',
    );
    expect(r).toMatchObject({ exifKept: false, iccKept: false, jpegOnly: false });
    expect(parseJpeg(await bytesOf(r.blob)).segments.map((s) => s.marker)).toEqual([
      MARKER.APP0,
      0xdb,
      0xc0,
      0xc4,
    ]);
  });

  it('throws a readable error for a broken JPEG', async () => {
    await expect(
      applyMetadata(blob(buildJpeg().subarray(0, 40)), meta(), 'strip-all'),
    ).rejects.toThrow(/JPEG/);
  });
});

describe('applyMetadata — PNG, WebP, AVIF', () => {
  const png = concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    new Uint8Array(20),
  );
  const webp = concat(ascii('RIFF'), new Uint8Array(4), ascii('WEBPVP8 '), new Uint8Array(20));
  const avif = concat(
    new Uint8Array([0, 0, 0, 0x1c]),
    ascii('ftypavif'),
    new Uint8Array(4),
    ascii('avifmif1miaf'),
  );

  it.each([
    ['png', png],
    ['webp', webp],
    ['avif', avif],
  ] as const)(
    '%s: keep-all keeps nothing and flags "JPG only"; strip-all needs no flag',
    async (format, bytes) => {
      expect(sniffFormat(bytes)).toBe(format);
      const keep = await applyMetadataDetailed(blob(bytes), meta(), 'keep-all');
      expect(keep.jpegOnly).toBe(true);
      expect(await bytesOf(keep.blob)).toEqual(bytes);
      const loc = await applyMetadataDetailed(blob(bytes), meta(), 'strip-location');
      expect(loc.jpegOnly).toBe(true);
      const strip = await applyMetadataDetailed(blob(bytes), meta(), 'strip-all');
      expect(strip.jpegOnly).toBe(false);
    },
  );
});
