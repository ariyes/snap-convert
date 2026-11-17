import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeGif } from './gif';
import { PixelDecodeError } from './raw';
import { corrupt, random } from './testing/fuzz';
import { writeGif, type GifSpec } from './testing/writers';

const MAX = 16_000_000;
const PALETTE = Array.from({ length: 256 }, (_, i): [number, number, number] => [i, (i * 3) & 255, 255 - i]);

function noise(seed: number, colours: number) {
  const rnd = random(seed);
  const cache = new Map<number, number>();
  return (x: number, y: number) => {
    let v = cache.get(y * 10000 + x);
    if (v === undefined) {
      v = Math.floor(rnd() * colours);
      cache.set(y * 10000 + x, v);
    }
    return v;
  };
}

/** Expected RGBA: the first frame on a transparent screen. */
function expected(spec: GifSpec): Uint8ClampedArray {
  const out = new Uint8ClampedArray(spec.width * spec.height * 4);
  const f = spec.frame;
  const table = f.localPalette ?? spec.palette!;
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const sx = (f.left ?? 0) + x;
      const sy = (f.top ?? 0) + y;
      if (sx >= spec.width || sy >= spec.height) continue;
      const idx = f.index(x, y);
      if (idx === f.transparent) continue;
      out.set([...(table[idx] ?? [0, 0, 0]), 255], (sy * spec.width + sx) * 4);
    }
  }
  return out;
}

describe('decodeGif', () => {
  const cases: Array<[string, GifSpec]> = [
    ['2 colours', { width: 9, height: 5, palette: PALETTE.slice(0, 2), frame: { width: 9, height: 5, index: noise(1, 2) } }],
    ['16 colours', { width: 31, height: 17, palette: PALETTE.slice(0, 16), frame: { width: 31, height: 17, index: noise(2, 16) } }],
    [
      '256-colour noise (dictionary fills and clears)',
      { width: 200, height: 150, palette: PALETTE, frame: { width: 200, height: 150, index: noise(3, 256) } },
    ],
    [
      'long runs (long dictionary chains)',
      { width: 300, height: 40, palette: PALETTE.slice(0, 4), frame: { width: 300, height: 40, index: (x) => (x > 150 ? 1 : 0) } },
    ],
    [
      'interlaced',
      { width: 23, height: 19, palette: PALETTE.slice(0, 8), frame: { width: 23, height: 19, index: noise(4, 8), interlaced: true } },
    ],
    [
      'transparent index',
      { width: 12, height: 12, palette: PALETTE.slice(0, 4), frame: { width: 12, height: 12, index: noise(5, 4), transparent: 2 } },
    ],
    [
      'offset frame with a local palette, partly off-screen',
      {
        width: 20,
        height: 10,
        palette: PALETTE.slice(0, 2),
        frame: { left: 15, top: 4, width: 10, height: 10, index: noise(6, 8), localPalette: PALETTE.slice(50, 58) },
      },
    ],
    [
      'second frame ignored',
      { width: 8, height: 8, palette: PALETTE.slice(0, 4), frame: { width: 8, height: 8, index: noise(7, 4) }, secondFrame: true },
    ],
  ];

  it.each(cases)('%s', (_label, spec) => {
    const img = decodeGif(writeGif(spec), MAX);
    expect([img.width, img.height]).toEqual([spec.width, spec.height]);
    expect(img.data).toEqual(expected(spec));
  });

  it('decodes the fixture (first frame, not the white second one)', () => {
    const img = decodeGif(new Uint8Array(readFileSync('tests/fixtures/images/sample.gif')), MAX);
    expect([img.width, img.height]).toEqual([40, 30]);
    expect(Array.from(img.data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('leaves the rest transparent when the data stops early', () => {
    const spec: GifSpec = { width: 50, height: 50, palette: PALETTE.slice(0, 4), frame: { width: 50, height: 50, index: () => 1 } };
    const bytes = writeGif(spec);
    const cut = bytes.slice(0, bytes.length - 6);
    const img = decodeGif(cut, MAX);
    expect(img.data[3]).toBe(255);
    expect(img.data[img.data.length - 1]).toBe(0);
  });

  it('refuses broken files with PixelDecodeError', () => {
    expect(() => decodeGif(new TextEncoder().encode('GIF89a'), MAX)).toThrow(PixelDecodeError);
    expect(() => decodeGif(new TextEncoder().encode('hello world, no gif'), MAX)).toThrow(PixelDecodeError);
    const noTable = writeGif({ width: 4, height: 4, frame: { width: 4, height: 4, index: () => 0 } });
    expect(() => decodeGif(noTable, MAX)).toThrow(/colour table/);
    const big = writeGif({ width: 4000, height: 4000, palette: PALETTE.slice(0, 2), frame: { width: 1, height: 1, index: () => 0 } });
    expect(() => decodeGif(big, 1_000_000)).toThrow(/too large/);
  });

  it('survives 2,000 random corruptions: readable error or a valid image, never a crash or hang', () => {
    const seeds = [
      new Uint8Array(readFileSync('tests/fixtures/images/sample.gif')),
      writeGif(cases[2]![1]),
      writeGif(cases[4]![1]),
      writeGif(cases[6]![1]),
    ];
    const rnd = random(77);
    let errors = 0;
    for (let i = 0; i < 2000; i++) {
      const bytes = corrupt(seeds[i % seeds.length]!, rnd);
      try {
        const img = decodeGif(bytes, MAX);
        expect(img.data.length).toBe(img.width * img.height * 4);
      } catch (error) {
        expect(error, `case ${i}`).toBeInstanceOf(PixelDecodeError);
        errors++;
      }
    }
    expect(errors).toBeGreaterThan(100);
  }, 60_000);
});
