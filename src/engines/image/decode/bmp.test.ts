import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeBmp } from './bmp';
import { PixelDecodeError } from './raw';
import { corrupt, random } from './testing/fuzz';
import { writeBmp, type BmpSpec } from './testing/writers';

const MAX = 16_000_000;
const PALETTE = Array.from({ length: 256 }, (_, i): [number, number, number] => [i, 255 - i, (i * 7) & 255]);

function values(seed: number, bits: number) {
  const rnd = random(seed);
  const cache = new Map<number, number>();
  return (x: number, y: number) => {
    let v = cache.get(y * 10000 + x);
    if (v === undefined) {
      v = Math.floor(rnd() * 2 ** bits) >>> 0;
      cache.set(y * 10000 + x, v);
    }
    return v;
  };
}

const scale = (v: number, bits: number) => Math.round((v * 255) / (2 ** bits - 1));

describe('decodeBmp', () => {
  it.each([1, 4, 8] as const)('%i-bit palette, bottom-up and top-down', (bpp) => {
    for (const topDown of [false, true]) {
      const pixel = values(bpp, bpp);
      const spec: BmpSpec = { width: 13, height: 7, bpp, pixel, palette: PALETTE.slice(0, 1 << bpp), topDown };
      const img = decodeBmp(writeBmp(spec), MAX);
      expect([img.width, img.height]).toEqual([13, 7]);
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 13; x++) {
          const i = (y * 13 + x) * 4;
          expect(Array.from(img.data.subarray(i, i + 4))).toEqual([...PALETTE[pixel(x, y)]!, 255]);
        }
      }
    }
  });

  it('8-bit palette with an OS/2 core header (3-byte palette entries)', () => {
    const pixel = values(9, 8);
    const img = decodeBmp(writeBmp({ width: 5, height: 3, bpp: 8, pixel, palette: PALETTE, header: 12 }), MAX);
    expect(Array.from(img.data.subarray(0, 4))).toEqual([...PALETTE[pixel(0, 0)]!, 255]);
  });

  it('16-bit 5-5-5 and 5-6-5 bit fields', () => {
    const p555 = values(10, 15);
    const a = decodeBmp(writeBmp({ width: 6, height: 4, bpp: 16, pixel: p555 }), MAX);
    const v = p555(2, 1);
    const i = (1 * 6 + 2) * 4;
    expect(Array.from(a.data.subarray(i, i + 4))).toEqual([
      scale((v >> 10) & 31, 5),
      scale((v >> 5) & 31, 5),
      scale(v & 31, 5),
      255,
    ]);
    const p565 = values(11, 16);
    const b = decodeBmp(writeBmp({ width: 6, height: 4, bpp: 16, pixel: p565, masks: [0xf800, 0x07e0, 0x001f] }), MAX);
    const w = p565(5, 3);
    const j = (3 * 6 + 5) * 4;
    expect(Array.from(b.data.subarray(j, j + 4))).toEqual([
      scale((w >> 11) & 31, 5),
      scale((w >> 5) & 63, 6),
      scale(w & 31, 5),
      255,
    ]);
  });

  it('24-bit, odd row padding', () => {
    const img = decodeBmp(new Uint8Array(readFileSync('tests/fixtures/images/sample.bmp')), MAX);
    expect([img.width, img.height]).toEqual([50, 30]);
    expect(Array.from(img.data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('32-bit: BI_RGB is opaque; bit-field alpha is kept unless it is zero everywhere', () => {
    const px = (x: number) => ((x * 60) << 24) | 0x102030;
    const rgb = decodeBmp(writeBmp({ width: 4, height: 1, bpp: 32, pixel: px }), MAX);
    expect(Array.from(rgb.data)).toEqual([16, 32, 48, 255, 16, 32, 48, 255, 16, 32, 48, 255, 16, 32, 48, 255]);
    const masks = [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000];
    const alpha = decodeBmp(writeBmp({ width: 4, height: 1, bpp: 32, pixel: px, header: 124, masks }), MAX);
    expect([alpha.data[3], alpha.data[7], alpha.data[11], alpha.data[15]]).toEqual([0, 60, 120, 180]);
    const zero = decodeBmp(writeBmp({ width: 2, height: 1, bpp: 32, pixel: () => 0x405060, header: 124, masks }), MAX);
    expect([zero.data[3], zero.data[7]]).toEqual([255, 255]);
  });

  it('refuses RLE, truncated data and oversized images with PixelDecodeError', () => {
    const good = writeBmp({ width: 8, height: 8, bpp: 24, pixel: () => 0x123456 });
    const rle = good.slice();
    new DataView(rle.buffer).setUint32(30, 1, true);
    expect(() => decodeBmp(rle, MAX)).toThrow(/compression/);
    expect(() => decodeBmp(good.slice(0, good.length - 10), MAX)).toThrow(/truncated/);
    expect(() => decodeBmp(good, 10)).toThrow(/too large/);
    expect(() => decodeBmp(new Uint8Array([0x42, 0x4d, 1, 2]), MAX)).toThrow(PixelDecodeError);
  });

  it('survives 2,000 random corruptions: readable error or a valid image, never a crash or hang', () => {
    const seeds = [
      new Uint8Array(readFileSync('tests/fixtures/images/sample.bmp')),
      writeBmp({ width: 11, height: 9, bpp: 4, pixel: values(1, 4), palette: PALETTE.slice(0, 16) }),
      writeBmp({ width: 11, height: 9, bpp: 16, pixel: values(2, 16), masks: [0xf800, 0x07e0, 0x001f] }),
      writeBmp({ width: 11, height: 9, bpp: 32, pixel: values(3, 32), header: 124, masks: [0xff0000, 0xff00, 0xff, 0xff000000] }),
    ];
    const rnd = random(99);
    let errors = 0;
    for (let i = 0; i < 2000; i++) {
      const bytes = corrupt(seeds[i % seeds.length]!, rnd);
      try {
        const img = decodeBmp(bytes, MAX);
        expect(img.data.length).toBe(img.width * img.height * 4);
      } catch (error) {
        expect(error, `case ${i}`).toBeInstanceOf(PixelDecodeError);
        errors++;
      }
    }
    expect(errors).toBeGreaterThan(100);
  }, 60_000);
});
