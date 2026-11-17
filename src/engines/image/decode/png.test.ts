import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePng } from './png';
import { PixelDecodeError } from './raw';
import { corrupt, random } from './testing/fuzz';
import { concat, pngChunk, u32be, writePng, type PngSpec } from './testing/writers';

const MAX = 16_000_000;

/** What a browser shows for a spec: the expected straight RGBA, computed independently. */
function expected(spec: PngSpec): Uint8ClampedArray {
  const { width, height, colorType, depth } = spec;
  const out = new Uint8ClampedArray(width * height * 4);
  const max = (1 << depth) - 1;
  const to8 = (v: number) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max));
  const key = (i: number) => (spec.trns ? (spec.trns[i * 2]! << 8) | spec.trns[i * 2 + 1]! : -1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = spec.samples(x, y);
      let px: number[];
      if (colorType === 0) px = [to8(s[0]!), to8(s[0]!), to8(s[0]!), s[0] === key(0) ? 0 : 255];
      else if (colorType === 2) {
        const transparent = !!spec.trns && s[0] === key(0) && s[1] === key(1) && s[2] === key(2);
        px = [to8(s[0]!), to8(s[1]!), to8(s[2]!), transparent ? 0 : 255];
      } else if (colorType === 3) {
        const c = spec.palette![s[0]!] ?? [0, 0, 0];
        px = [...c, spec.trns && s[0]! < spec.trns.length ? spec.trns[s[0]!]! : 255];
      } else if (colorType === 4) px = [to8(s[0]!), to8(s[0]!), to8(s[0]!), to8(s[1]!)];
      else px = s.map(to8);
      out.set(px, (y * width + x) * 4);
    }
  }
  return out;
}

function samplesFor(colorType: number, depth: number, seed: number): PngSpec['samples'] {
  const rnd = random(seed);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 1;
  const max = colorType === 3 ? 15 : (1 << depth) - 1;
  const cache = new Map<number, number[]>();
  return (x, y) => {
    let v = cache.get(y * 10000 + x);
    if (!v) {
      v = Array.from({ length: channels }, () => Math.floor(rnd() * (max + 1)) & ((1 << depth) - 1));
      cache.set(y * 10000 + x, v);
    }
    return v;
  };
}

const PALETTE = Array.from({ length: 16 }, (_, i): [number, number, number] => [i * 16, 255 - i * 9, i * 5]);

const COMBOS: Array<[PngSpec['colorType'], PngSpec['depth']]> = [
  [0, 1],
  [0, 2],
  [0, 4],
  [0, 8],
  [0, 16],
  [2, 8],
  [2, 16],
  [3, 1],
  [3, 2],
  [3, 4],
  [3, 8],
  [4, 8],
  [4, 16],
  [6, 8],
  [6, 16],
];

describe('decodePng', () => {
  it.each(COMBOS.flatMap(([t, d]) => [false, true].map((i) => [t, d, i] as const)))(
    'colour type %i, %i-bit, interlaced %s',
    async (colorType, depth, interlaced) => {
      // Sizes chosen so Adam7 has empty passes (1×1, 3×2) and odd edges.
      for (const [width, height] of [
        [1, 1],
        [3, 2],
        [17, 9],
        [33, 20],
      ] as const) {
        const spec: PngSpec = {
          width,
          height,
          colorType,
          depth,
          interlaced,
          samples: samplesFor(colorType, depth, width * 31 + depth),
          ...(colorType === 3 ? { palette: PALETTE.slice(0, Math.min(16, 1 << depth)) } : {}),
        };
        const { image } = await decodePng(writePng(spec), MAX);
        expect([image.width, image.height]).toEqual([width, height]);
        expect(image.data).toEqual(expected(spec));
      }
    },
  );

  it('applies tRNS colour keys and palette alpha', async () => {
    const specs: PngSpec[] = [
      { width: 9, height: 7, colorType: 0, depth: 4, samples: samplesFor(0, 4, 1), trns: new Uint8Array([0, 5]) },
      { width: 9, height: 7, colorType: 0, depth: 16, samples: samplesFor(0, 16, 2), trns: new Uint8Array([0x80, 0]) },
      {
        width: 9,
        height: 7,
        colorType: 2,
        depth: 8,
        samples: (x) => (x % 2 ? [1, 2, 3] : [4, 5, 6]),
        trns: new Uint8Array([0, 1, 0, 2, 0, 3]),
      },
      {
        width: 9,
        height: 7,
        colorType: 3,
        depth: 4,
        samples: samplesFor(3, 4, 3),
        palette: PALETTE,
        trns: new Uint8Array([0, 50, 100]),
      },
    ];
    for (const spec of specs) {
      const { image } = await decodePng(writePng(spec), MAX);
      expect(image.data).toEqual(expected(spec));
    }
  });

  it('reports colour chunks', async () => {
    const base: PngSpec = { width: 2, height: 2, colorType: 2, depth: 8, samples: () => [1, 2, 3] };
    const chrm = u32be(31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000);
    const png = writePng({
      ...base,
      chunks: [
        { type: 'gAMA', data: u32be(55556) },
        { type: 'cHRM', data: chrm },
      ],
    });
    const out = await decodePng(png, MAX);
    expect(out.gamma).toBeCloseTo(0.55556, 5);
    expect(out.chromaticities?.red).toEqual([0.64, 0.33]);
    expect(out).toMatchObject({ srgb: false, iccp: false });
    const srgb = await decodePng(writePng({ ...base, chunks: [{ type: 'sRGB', data: new Uint8Array([0]) }] }), MAX);
    expect(srgb.srgb).toBe(true);
  });

  it('skips a damaged ancillary chunk but refuses a damaged IDAT', async () => {
    const png = writePng({
      width: 4,
      height: 4,
      colorType: 2,
      depth: 8,
      samples: () => [9, 8, 7],
      chunks: [{ type: 'tEXt', data: new TextEncoder().encode('Comment\0hello') }],
    });
    const text = findChunk(png, 'tEXt');
    const badText = png.slice();
    badText[text + 9] ^= 0xff;
    await expect(decodePng(badText, MAX)).resolves.toBeDefined();
    const idat = findChunk(png, 'IDAT');
    const badIdat = png.slice();
    badIdat[idat + 9] ^= 0xff;
    await expect(decodePng(badIdat, MAX)).rejects.toThrow(/bad CRC in IDAT/);
  });

  it('refuses broken files with PixelDecodeError', async () => {
    const good = writePng({ width: 8, height: 8, colorType: 6, depth: 8, samples: () => [1, 2, 3, 4] });
    await expect(decodePng(new Uint8Array([1, 2, 3]), MAX)).rejects.toThrow(PixelDecodeError);
    await expect(decodePng(good.slice(0, 40), MAX)).rejects.toThrow(PixelDecodeError);
    // Palette image without PLTE.
    const noPlte = writePng({ width: 4, height: 4, colorType: 3, depth: 8, samples: () => [0] });
    await expect(decodePng(noPlte, MAX)).rejects.toThrow(/PLTE/);
    // Unknown filter type 7 (with a correct CRC).
    const { zlibSync } = await import('fflate');
    const raw = new Uint8Array(1 + 4 * 1);
    raw[0] = 7;
    const ihdr = concat([u32be(1, 1), new Uint8Array([8, 6, 0, 0, 0])]);
    const bad = concat([
      good.subarray(0, 8),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlibSync(raw)),
      pngChunk('IEND', new Uint8Array()),
    ]);
    await expect(decodePng(bad, MAX)).rejects.toThrow(/filter type/);
  });

  it('refuses sizes over the limit before inflating', async () => {
    const png = writePng({ width: 300, height: 200, colorType: 0, depth: 1, samples: () => [1] });
    const error = await decodePng(png, 50_000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PixelDecodeError);
    expect((error as PixelDecodeError).tooLarge).toBe(true);
  });

  it('survives 2,000 random corruptions: readable error or a valid image, never a crash or hang', async () => {
    const seeds: Uint8Array[] = [
      new Uint8Array(readFileSync('tests/fixtures/images/alpha.png')),
      writePng({ width: 21, height: 13, colorType: 6, depth: 16, interlaced: true, samples: samplesFor(6, 16, 7) }),
      writePng({ width: 30, height: 11, colorType: 3, depth: 2, samples: samplesFor(3, 2, 8), palette: PALETTE.slice(0, 4) }),
    ];
    const rnd = random(2024);
    let errors = 0;
    for (let i = 0; i < 2000; i++) {
      const source = seeds[i % seeds.length]!;
      // Half plain corruptions (mostly caught by CRCs); half inside a chunk with the CRC fixed,
      // so the header checks, inflate and unfiltering see the damage.
      const bytes = i % 2 === 0 ? corrupt(source, rnd) : corruptChunk(source, rnd);
      try {
        const { image } = await decodePng(bytes, MAX);
        expect(image.data.length).toBe(image.width * image.height * 4);
      } catch (error) {
        expect(error, `case ${i}`).toBeInstanceOf(PixelDecodeError);
        errors++;
      }
    }
    expect(errors).toBeGreaterThan(500);
  }, 60_000);
});

function findChunk(png: Uint8Array, type: string): number {
  let at = 8;
  while (at + 8 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset).getUint32(at);
    if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === type) return at;
    at += 12 + len;
  }
  throw new Error(`no ${type}`);
}

/** Corrupts the data of one chunk and recomputes its CRC. */
function corruptChunk(png: Uint8Array, rnd: () => number): Uint8Array {
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset).getUint32(at);
    chunks.push({ type: String.fromCharCode(...png.subarray(at + 4, at + 8)), data: png.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  const target = Math.floor(rnd() * chunks.length);
  // pngChunk writes a correct CRC, so the damage reaches the decoder.
  const parts = chunks.map((c, i) =>
    pngChunk(c.type, i === target && c.data.length > 0 ? corrupt(c.data, rnd) : c.data),
  );
  return concat([png.subarray(0, 8), ...parts]);
}
