import { describe, expect, it } from 'vitest';
import {
  HEADER_READ_BYTES,
  headerSizeFromBytes,
  readExifOrientation,
  readHeaderSize,
} from './header';
import { fixtureBytes, fixtureFile } from './test-fixtures';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u16be = (n: number) => [(n >> 8) & 255, n & 255];
const u32be = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

/** Minimal big-endian TIFF block with one IFD0 entry: Orientation (SHORT). */
function exifWithOrientation(orientation: number, type = 3): number[] {
  const value = type === 3 ? [...u16be(orientation), 0, 0] : u32be(orientation);
  return [
    ...ascii('MM'),
    0,
    42,
    ...u32be(8),
    ...u16be(1),
    ...u16be(0x0112),
    ...u16be(type),
    ...u32be(1),
    ...value,
    ...u32be(0),
  ];
}

/** PNG signature + IHDR (+ optional eXIf). CRCs are zero: the header reader doesn't check them. */
function png(width: number, height: number, exif?: number[]): Uint8Array {
  const chunk = (type: string, data: number[]) => [
    ...u32be(data.length),
    ...ascii(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]),
    ...(exif ? chunk('eXIf', exif) : []),
    ...chunk('IEND', []),
  ]);
}

/** ISO-BMFF box. */
const box = (type: string, ...payload: number[][]) => {
  const body = payload.flat();
  return [...u32be(8 + body.length), ...ascii(type), ...body];
};
const fullBox = (type: string, ...payload: number[][]) => box(type, [0, 0, 0, 0], ...payload);

/** A HEIF header whose primary item has a size and, optionally, a rotation (irot, quarter turns anti-clockwise). */
function heif(width: number, height: number, quarterTurns?: number): Uint8Array {
  const props = [fullBox('ispe', u32be(width), u32be(height))];
  if (quarterTurns !== undefined) props.push(box('irot', [quarterTurns]));
  const indexes = props.map((_, i) => i + 1);
  return new Uint8Array([
    ...box('ftyp', ascii('heic'), u32be(0), ascii('mif1heic')),
    ...fullBox(
      'meta',
      fullBox('pitm', u16be(1)),
      box(
        'iprp',
        box('ipco', ...props),
        fullBox('ipma', u32be(1), u16be(1), [indexes.length], indexes),
      ),
    ),
  ]);
}

describe('header size on fixtures', () => {
  it.each([
    ['images/no-exif.jpg', 96, 64],
    ['images/gps.jpg', 96, 64],
    ['images/alpha.png', 90, 60],
    ['images/sample.webp', 80, 60], // VP8X
    ['intake/webp-alpha.webp', 72, 40], // VP8X + ALPH
    ['intake/webp-lossy.webp', 72, 40], // VP8
    ['intake/webp-lossless.webp', 72, 40], // VP8L
    ['images/sample.gif', 40, 30],
    ['images/sample.bmp', 50, 30],
    ['images/sample.avif', 80, 60],
    ['images/iphone-7.heic', 4032, 3024],
    ['intake/jpeg-renamed.png', 96, 64], // a JPEG with orientation 6
  ])('%s → %i × %i', async (path, width, height) => {
    expect(await readHeaderSize(fixtureFile(path))).toEqual({ width, height });
  });

  // Stored 96 × 64 (1–4) or 64 × 96 (5–8); all of them are 96 × 64 upright.
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'JPEG with EXIF orientation %i → upright 96 × 64',
    async (o) => {
      expect(await readHeaderSize(fixtureFile(`images/orientation-${o}.jpg`))).toEqual({
        width: 96,
        height: 64,
      });
    },
  );

  it('swaps for PNG eXIf orientation 5–8 only', async () => {
    expect(await headerSizeFromBytes(png(90, 60, exifWithOrientation(6)))).toEqual({
      width: 60,
      height: 90,
    });
    expect(await headerSizeFromBytes(png(90, 60, exifWithOrientation(3)))).toEqual({
      width: 90,
      height: 60,
    });
    expect(await headerSizeFromBytes(png(90, 60))).toEqual({ width: 90, height: 60 });
  });

  it('applies a HEIF quarter turn (irot), not a half turn', async () => {
    expect(await headerSizeFromBytes(heif(4032, 3024))).toEqual({ width: 4032, height: 3024 });
    expect(await headerSizeFromBytes(heif(4032, 3024, 1))).toEqual({ width: 3024, height: 4032 });
    expect(await headerSizeFromBytes(heif(4032, 3024, 2))).toEqual({ width: 4032, height: 3024 });
    expect(await headerSizeFromBytes(heif(4032, 3024, 3))).toEqual({ width: 3024, height: 4032 });
  });
});

describe('reading at most 256 KB', () => {
  /** Records every range read from the file. */
  function spy(file: File) {
    const ranges: Array<[number | undefined, number | undefined]> = [];
    const slice = file.slice.bind(file);
    file.slice = (start?: number, end?: number) => {
      ranges.push([start, end]);
      return slice(start, end);
    };
    return ranges;
  }

  it('reads only the first 256 KB of a large file', async () => {
    const file = fixtureFile('images/iphone-7.heic'); // 860 KB
    expect(file.size).toBeGreaterThan(HEADER_READ_BYTES);
    const ranges = spy(file);
    expect(await readHeaderSize(file)).toEqual({ width: 4032, height: 3024 });
    expect(ranges).toEqual([[0, HEADER_READ_BYTES]]);
  });

  it("doesn't find a JPEG size that sits after the first 256 KB", async () => {
    const filler = Array.from({ length: 5 }, () => [
      0xff,
      0xe3,
      0xff,
      0xff,
      ...new Array<number>(0xfffd).fill(0),
    ]).flat();
    const sof = [
      0xff,
      0xc0,
      0,
      17,
      8,
      ...u16be(3000),
      ...u16be(4000),
      3,
      1,
      0x22,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1,
    ];
    const bytes = new Uint8Array([0xff, 0xd8, ...filler, ...sof, 0xff, 0xd9]);
    expect(bytes.length).toBeGreaterThan(HEADER_READ_BYTES);
    expect(await readHeaderSize(new File([bytes], 'big.jpg'))).toBeUndefined();
    expect(await headerSizeFromBytes(bytes)).toBeUndefined();
  });
});

describe('truncated and corrupt headers', () => {
  /** Every prefix of the file (or every `step`-th) gives either nothing or the right size — never a wrong one. */
  async function checkPrefixes(path: string, step = 1, limit = Infinity) {
    const bytes = fixtureBytes(path);
    const full = await headerSizeFromBytes(bytes);
    expect(full).toBeDefined();
    const end = Math.min(bytes.length, limit);
    let undefinedSeen = false;
    for (let n = 0; n < end; n += step) {
      const got = await headerSizeFromBytes(bytes.subarray(0, n));
      if (got === undefined) undefinedSeen = true;
      else expect(got, `${path} cut at ${n}`).toEqual(full);
    }
    expect(undefinedSeen).toBe(true);
  }

  it.each([
    'images/orientation-6.jpg',
    'images/orientation-1.jpg',
    'images/alpha.png',
    'images/sample.webp',
    'intake/webp-lossy.webp',
    'intake/webp-lossless.webp',
    'images/sample.gif',
    'images/sample.bmp',
    'images/sample.avif',
  ])('%s cut anywhere: undefined or right, never wrong', async (path) => {
    await checkPrefixes(path);
  });

  it('HEIC cut anywhere in its header', async () => {
    await checkPrefixes('images/iphone-7.heic', 1009, 16 * 1024);
  });

  it('cut size fields return undefined, not a guess', async () => {
    // A 4032 × 3024 JPEG whose SOF is cut after the first byte of the width (0x0F of 0x0FC0).
    const sof = [0xff, 0xc0, 0, 17, 8, ...u16be(3024), ...u16be(4032)];
    const full = new Uint8Array([
      0xff,
      0xd8,
      ...sof,
      3,
      1,
      0x22,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1,
      0xff,
      0xd9,
    ]);
    expect(await headerSizeFromBytes(full)).toEqual({ width: 4032, height: 3024 });
    expect(await headerSizeFromBytes(full.subarray(0, 2 + sof.length - 1))).toBeUndefined();
  });

  it('never throws on garbage', async () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
    const heads = [
      [0xff, 0xd8, 0xff], // JPEG magic, nothing else
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff, 0xff, 0xff], // PNG, absurd chunk length
      [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 0xff, 0xff, 0xff, 0xff],
      [...ascii('GIF89a')],
      [...ascii('BM'), ...new Array<number>(12).fill(0), 40, 0, 0, 0],
      [0, 0, 0, 1, ...ascii('ftypheic')], // box size 1 = 64-bit size that isn't there
    ];
    for (const head of heads) {
      for (let i = 0; i < 20; i++) {
        const tail = Array.from({ length: i * 7 }, random);
        await expect(
          headerSizeFromBytes(new Uint8Array([...head, ...tail])),
        ).resolves.not.toThrow();
      }
    }
    expect(await headerSizeFromBytes(new Uint8Array(0))).toBeUndefined();
    expect(await headerSizeFromBytes(new Uint8Array(ascii('not an image at all')))).toBeUndefined();
  });

  it('a GIF or PNG claiming 0 × 0 has no size', async () => {
    expect(await headerSizeFromBytes(png(0, 0))).toBeUndefined();
    expect(
      await headerSizeFromBytes(new Uint8Array([...ascii('GIF89a'), 0, 0, 0, 0, 0, 0, 0])),
    ).toBeUndefined();
  });

  it('an unreadable file has no size', async () => {
    const file = new File(['x'], 'a.jpg');
    file.slice = () => {
      throw new Error('gone');
    };
    expect(await readHeaderSize(file)).toBeUndefined();
  });
});

describe('readExifOrientation', () => {
  it('reads SHORT and LONG values, both byte orders', () => {
    expect(readExifOrientation(new Uint8Array(exifWithOrientation(6)))).toBe(6);
    expect(readExifOrientation(new Uint8Array(exifWithOrientation(8, 4)))).toBe(8);
    const le = new Uint8Array([
      ...ascii('II'),
      42,
      0,
      8,
      0,
      0,
      0,
      1,
      0,
      0x12,
      0x01,
      3,
      0,
      1,
      0,
      0,
      0,
      5,
      0,
      0,
      0,
    ]);
    expect(readExifOrientation(le)).toBe(5);
  });

  it('is undefined for missing, out-of-range or cut data', () => {
    expect(readExifOrientation(undefined)).toBeUndefined();
    expect(readExifOrientation(new Uint8Array(exifWithOrientation(9)))).toBeUndefined();
    expect(readExifOrientation(new Uint8Array(exifWithOrientation(0)))).toBeUndefined();
    const full = exifWithOrientation(6);
    for (let n = 0; n < 20; n++)
      expect(readExifOrientation(new Uint8Array(full.slice(0, n)))).toBeUndefined();
    expect(
      readExifOrientation(new Uint8Array([...ascii('XX'), 0, 42, 0, 0, 0, 8])),
    ).toBeUndefined();
  });
});
