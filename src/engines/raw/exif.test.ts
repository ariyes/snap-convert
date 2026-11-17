import { describe, expect, it } from 'vitest';
import { TAG, writeExif } from '../../../tests/fixtures/writers';
import { compactExif } from './exif';

type Tags = Record<string, unknown>;

async function parse(tiff: ArrayBuffer): Promise<Tags> {
  const { parse } = await import('exifr');
  const out: unknown = await parse(new Uint8Array(tiff), {
    tiff: true,
    ifd0: {},
    exif: true,
    gps: true,
    makerNote: true,
    translateKeys: false,
    translateValues: false,
    reviveValues: false,
    mergeOutput: true,
  });
  return (out ?? {}) as Tags;
}

const MAKER_NOTE = 0x927c;
const STRIP_OFFSETS = 0x0111;
const EXPOSURE_TIME = 0x829a;

const raw = writeExif({
  ifd0: {
    [TAG.Make]: { type: 'ascii', value: 'Canon' },
    [TAG.Model]: { type: 'ascii', value: 'Canon EOS M50' },
    [TAG.Orientation]: { type: 'short', value: 6 },
    [STRIP_OFFSETS]: { type: 'long', value: 123456 },
  },
  exif: {
    [TAG.DateTimeOriginal]: { type: 'ascii', value: '2021:05:10 20:11:06' },
    [EXPOSURE_TIME]: { type: 'rational', value: [[1, 125]] },
    [MAKER_NOTE]: { type: 'ascii', value: 'x'.repeat(2000) },
  },
  gps: {
    [TAG.GPSLatitudeRef]: { type: 'ascii', value: 'N' },
    [TAG.GPSLatitude]: {
      type: 'rational',
      value: [
        [51, 1],
        [30, 1],
        [0, 1],
      ],
    },
  },
});

describe('compactExif', () => {
  it('keeps camera, orientation, exposure, dates and GPS; drops the maker note and RAW image tags', async () => {
    const compact = compactExif(raw);
    expect(compact).toBeDefined();
    const tags = await parse(compact!);
    expect(tags[TAG.Make]).toBe('Canon');
    expect(tags[TAG.Model]).toBe('Canon EOS M50');
    expect(tags[TAG.Orientation]).toBe(6);
    expect(tags[TAG.DateTimeOriginal]).toBe('2021:05:10 20:11:06');
    expect(tags[EXPOSURE_TIME]).toBeCloseTo(1 / 125, 6);
    expect(tags[TAG.GPSLatitude]).toEqual([51, 30, 0]);
    expect(tags[MAKER_NOTE]).toBeUndefined();
    expect(tags[STRIP_OFFSETS]).toBeUndefined();
    expect(compact!.byteLength).toBeLessThan(raw.length - 2000);
  });

  it('keeps big-endian streams big-endian', async () => {
    // Swap the writer's little-endian header for a hand-made big-endian IFD0 with Make only.
    const be = new Uint8Array([
      0x4d,
      0x4d,
      0x00,
      0x2a,
      0x00,
      0x00,
      0x00,
      0x08, // header
      0x00,
      0x01, // one entry
      0x01,
      0x0f,
      0x00,
      0x02,
      0x00,
      0x00,
      0x00,
      0x04,
      0x4e,
      0x4f,
      0x4e,
      0x00, // Make "NON"
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const compact = compactExif(be);
    expect(String.fromCharCode(...new Uint8Array(compact!).slice(0, 2))).toBe('MM');
    expect((await parse(compact!))[TAG.Make]).toBe('NON');
  });

  it('returns undefined for anything that is not a TIFF stream, or has nothing to keep', () => {
    expect(compactExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeUndefined();
    expect(compactExif(new Uint8Array(0))).toBeUndefined();
    const onlyStrips = writeExif({ ifd0: { [STRIP_OFFSETS]: { type: 'long', value: 1 } } });
    expect(compactExif(onlyStrips)).toBeUndefined();
  });

  it('survives a truncated stream', () => {
    expect(() => compactExif(raw.slice(0, 40))).not.toThrow();
  });
});
