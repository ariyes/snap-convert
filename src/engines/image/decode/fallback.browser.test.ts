// P12b acceptance: with OffscreenCanvas switched off in the worker, every file decodes to the same
// size and the same pixels as the canvas path (max channel difference ≤ 2). Both sides run the
// real decodeImage in a worker; only the canvas switch differs.
//
// Translucent pixels are compared premultiplied: the canvas path stores pixels premultiplied, so
// a pixel with alpha 3 can only come back as one of a few colours there, while the canvas-free
// decoders keep the file's exact values. What you see (colour × alpha) is what's compared.
import { afterAll, describe, expect, it } from 'vitest';
import { TAG, writeExif } from '../../../../tests/fixtures/writers';
import { readContainer } from './container';
import { decodeStrings } from './strings';
import { encodeWithCanvas, fixture } from './test-utils';
import type { PixelsReply } from './testing/pixels-worker';
import {
  concat,
  pngChunk,
  u32be,
  writeBmp,
  writeGif,
  writePng,
  type BmpSpec,
  type GifSpec,
  type PngSpec,
} from './testing/writers';

/** A worker that answers one decode at a time, in order. */
function decoder(worker: Worker) {
  let chain: Promise<unknown> = Promise.resolve();
  const decode = (file: Blob) => {
    const run = chain.then(
      () =>
        new Promise<PixelsReply>((resolve, reject) => {
          worker.onmessage = (e: MessageEvent<PixelsReply>) => resolve(e.data);
          worker.onerror = (e) => reject(new Error(e.message));
          worker.postMessage(file);
        }),
    );
    chain = run.catch(() => undefined);
    return run;
  };
  return { decode, stop: () => worker.terminate() };
}

// Literal `new Worker(new URL(…))` so Vite bundles them as workers.
const withCanvas = decoder(
  new Worker(new URL('./testing/pixels-worker.ts', import.meta.url), { type: 'module' }),
);
const withoutCanvas = decoder(
  new Worker(new URL('./testing/pixels-worker-no-canvas.ts', import.meta.url), { type: 'module' }),
);

interface Row {
  name: string;
  size: string;
  maxDiff: number;
  differing: number;
}
const rows: Row[] = [];

afterAll(() => {
  withCanvas.stop();
  withoutCanvas.stop();
  const lines = rows.map(
    (r) =>
      `| ${r.name.padEnd(44)} | ${r.size.padEnd(9)} | ${String(r.maxDiff).padStart(8)} | ${String(r.differing).padStart(9)} |`,
  );
  // eslint-disable-next-line no-console -- the comparison table is part of the P12b report
  console.log(
    [
      '',
      'Canvas path vs canvas-free path (max channel difference; pixels that differ at all)',
      `| ${'File'.padEnd(44)} | ${'Size'.padEnd(9)} | Max diff | Differing |`,
      ...lines,
      '',
    ].join('\n'),
  );
});

/** Largest difference over all pixels (alpha exact; colour straight when opaque, premultiplied otherwise). */
function compare(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
): { maxDiff: number; differing: number } {
  let maxDiff = 0;
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3]!;
    const ba = b[i + 3]!;
    let d = Math.abs(aa - ba);
    for (let c = 0; c < 3; c++) {
      const x = a[i + c]!;
      const y = b[i + c]!;
      const diff =
        aa === 255 && ba === 255
          ? Math.abs(x - y)
          : Math.abs(Math.round((x * aa) / 255) - Math.round((y * ba) / 255));
      if (diff > d) d = diff;
    }
    if (d > 0) differing++;
    if (d > maxDiff) maxDiff = d;
  }
  return { maxDiff, differing };
}

async function expectSame(name: string, file: Blob, tolerance = 2): Promise<void> {
  const [c, f] = await Promise.all([withCanvas.decode(file), withoutCanvas.decode(file)]);
  expect(c.canvas, 'reference worker has a canvas').toBe(true);
  expect(f.canvas, 'switched-off worker has no canvas').toBe(false);
  expect(c.ok, `${name} (canvas): ${c.error}`).toBe(true);
  expect(f.ok, `${name} (no canvas): ${f.error}`).toBe(true);
  expect([f.width, f.height], name).toEqual([c.width, c.height]);
  expect(f.hasAlpha, name).toBe(c.hasAlpha);
  expect(f.orientation, name).toBe(c.orientation);
  const { maxDiff, differing } = compare(c.data!, f.data!);
  rows.push({ name, size: `${c.width}×${c.height}`, maxDiff, differing });
  expect(maxDiff, `${name}: max channel difference`).toBeLessThanOrEqual(tolerance);
}

/** Small deterministic PRNG (mulberry32). */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);

describe('fixtures decode to the same pixels without a canvas', () => {
  it.each([
    'orientation-1.jpg',
    'orientation-2.jpg',
    'orientation-3.jpg',
    'orientation-4.jpg',
    'orientation-5.jpg',
    'orientation-6.jpg',
    'orientation-7.jpg',
    'orientation-8.jpg',
    'gps.jpg',
    'no-exif.jpg',
    'alpha.png',
    'opaque.png',
    'sample.webp',
    'sample.gif',
    'sample.bmp',
  ])('images/%s', async (name) => {
    await expectSame(`images/${name}`, await fixture(`images/${name}`));
  });

  // AVIF: the canvas side is Chromium's own AVIF decoder, the canvas-free side libavif (jSquash).
  it('images/sample.avif', async () => {
    await expectSame('images/sample.avif', await fixture('images/sample.avif'));
  });

  it('images/iphone-7.heic', async () => {
    await expectSame('images/iphone-7.heic', await fixture('images/iphone-7.heic'));
  }, 60_000);

  it.each([
    'photo-fine-detail.jpg',
    'photo-night-noise.jpg',
    'photo-product-on-white.jpg',
    'photo-portrait-exif-rotated.jpg',
    'sky-gradient.png',
    'text-screenshot.png',
    'line-art-logo.png',
  ])(
    'quality/%s',
    async (name) => {
      await expectSame(`quality/${name}`, await fixture(`quality/${name}`));
    },
    60_000,
  );
});

// ---------- PNG: every colour type, bit depth, tRNS and Adam7 ----------

type PngCase = [string, Omit<PngSpec, 'width' | 'height' | 'samples' | 'interlaced'>];

const PALETTE_16: Array<[number, number, number]> = Array.from({ length: 16 }, (_, i) => [
  (i * 53) & 255,
  (i * 97 + 30) & 255,
  (i * 151 + 60) & 255,
]);

const PNG_CASES: PngCase[] = [
  ['grey 1-bit', { colorType: 0, depth: 1 }],
  ['grey 2-bit', { colorType: 0, depth: 2 }],
  ['grey 4-bit', { colorType: 0, depth: 4 }],
  ['grey 8-bit', { colorType: 0, depth: 8 }],
  ['grey 16-bit', { colorType: 0, depth: 16 }],
  ['grey 8-bit + tRNS', { colorType: 0, depth: 8, trns: new Uint8Array([0, 7]) }],
  ['grey 2-bit + tRNS', { colorType: 0, depth: 2, trns: new Uint8Array([0, 1]) }],
  ['grey 16-bit + tRNS', { colorType: 0, depth: 16, trns: new Uint8Array([0x12, 0x34]) }],
  ['RGB 8-bit', { colorType: 2, depth: 8 }],
  ['RGB 16-bit', { colorType: 2, depth: 16 }],
  ['RGB 8-bit + tRNS', { colorType: 2, depth: 8, trns: new Uint8Array([0, 7, 0, 7, 0, 7]) }],
  ['palette 1-bit', { colorType: 3, depth: 1, palette: PALETTE_16.slice(0, 2) }],
  ['palette 2-bit', { colorType: 3, depth: 2, palette: PALETTE_16.slice(0, 4) }],
  [
    'palette 4-bit + tRNS',
    { colorType: 3, depth: 4, palette: PALETTE_16, trns: new Uint8Array([0, 64, 128, 200, 255]) },
  ],
  ['palette 8-bit', { colorType: 3, depth: 8, palette: PALETTE_16 }],
  ['grey+alpha 8-bit', { colorType: 4, depth: 8 }],
  ['grey+alpha 16-bit', { colorType: 4, depth: 16 }],
  ['RGBA 8-bit', { colorType: 6, depth: 8 }],
  ['RGBA 16-bit', { colorType: 6, depth: 16 }],
];

/** Smooth gradients plus noise, so filters, rounding and edges all matter. */
function pngSamples(spec: PngCase[1], seed: number): PngSpec['samples'] {
  const rnd = random(seed);
  const max = (1 << spec.depth) - 1;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[spec.colorType];
  const cache = new Map<number, number[]>();
  return (x, y) => {
    const key = y * 4096 + x;
    let v = cache.get(key);
    if (!v) {
      if (spec.colorType === 3) {
        v = [Math.floor(rnd() * (spec.palette?.length ?? 1))];
      } else if (spec.trns && rnd() < 0.2) {
        // Exactly the transparent colour key.
        const k = (i: number) => (spec.trns![i * 2]! << 8) | spec.trns![i * 2 + 1]!;
        v = channels === 1 ? [k(0)] : [k(0), k(1), k(2)];
      } else {
        v = Array.from({ length: channels }, (_, c) => {
          const base = ((x * (c + 1) * 7 + y * 5) / 300) * max;
          const noise = (rnd() - 0.5) * max * 0.3;
          const isAlpha = (channels === 2 && c === 1) || (channels === 4 && c === 3);
          if (isAlpha) return rnd() < 0.15 ? 0 : rnd() < 0.3 ? max : Math.floor(rnd() * max);
          return Math.max(0, Math.min(max, Math.round(base + noise)));
        });
      }
      cache.set(key, v);
    }
    return v;
  };
}

describe('generated PNGs decode to the same pixels without a canvas', () => {
  const cases = PNG_CASES.flatMap(([label, spec], i) =>
    [false, true].map((interlaced) => [label, spec, interlaced, i] as const),
  );
  it.each(cases)('%s, interlaced %s', async (label, spec, interlaced, i) => {
    const png = writePng({
      ...spec,
      width: 37 + i,
      height: 23 + (i % 5),
      interlaced,
      samples: pngSamples(spec, i + 1),
      idatCount: 3,
    });
    await expectSame(`PNG ${label}${interlaced ? ' (Adam7)' : ''}`, blob(png));
  });

  it('PNG with EXIF orientation 6 (eXIf chunk)', async () => {
    const exif = writeExif({ ifd0: { [TAG.Orientation]: { type: 'short', value: 6 } } });
    const spec = PNG_CASES.find(([l]) => l === 'RGB 8-bit')![1];
    const png = writePng({
      ...spec,
      width: 40,
      height: 24,
      samples: pngSamples(spec, 99),
      chunks: [{ type: 'eXIf', data: exif }],
    });
    await expectSame('PNG eXIf orientation 6', blob(png));
  });
});

// ---------- colour management ----------

describe('colour profiles and PNG colour chunks match the browser', () => {
  async function p3Profile(): Promise<Uint8Array> {
    const heic = new Uint8Array(await (await fixture('images/iphone-7.heic')).arrayBuffer());
    const icc = (await readContainer(heic)).icc;
    if (!icc) throw new Error('no ICC profile in the HEIC fixture');
    return icc;
  }

  function colourCard(width: number, height: number): ImageData {
    const img = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        img.data.set(
          [(x * 255) / (width - 1), (y * 255) / (height - 1), 255 - ((x * 2) % 256), 255],
          i,
        );
      }
    }
    return img;
  }

  const rgbSamples: PngSpec['samples'] = (x, y) => [(x * 4) & 255, (y * 6) & 255, (x * y) & 255];

  it('JPEG with a Display P3 profile', async () => {
    const icc = await p3Profile();
    const jpeg = await encodeWithCanvas(colourCard(64, 48), 'image/jpeg', 0.95);
    const payload = concat([
      new TextEncoder().encode('ICC_PROFILE\0'),
      new Uint8Array([1, 1]),
      icc,
    ]);
    const app2 = concat([
      new Uint8Array([0xff, 0xe2, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]),
      payload,
    ]);
    await expectSame(
      'JPEG + Display P3 ICC',
      blob(concat([jpeg.subarray(0, 2), app2, jpeg.subarray(2)])),
    );
  });

  it('PNG with a Display P3 iCCP profile', async () => {
    const { zlibSync } = await import('fflate');
    const icc = await p3Profile();
    const iccp = concat([new TextEncoder().encode('P3\0'), new Uint8Array([0]), zlibSync(icc)]);
    const png = writePng({
      width: 64,
      height: 48,
      colorType: 2,
      depth: 8,
      samples: rgbSamples,
      chunks: [{ type: 'iCCP', data: iccp }],
    });
    await expectSame('PNG + Display P3 iCCP', blob(png));
  });

  const gama = (g: number) => ({ type: 'gAMA', data: u32be(Math.round(g * 100000)) });
  const p3Chrm = {
    type: 'cHRM',
    data: u32be(31270, 32900, 68000, 32000, 26500, 69000, 15000, 6000),
  };
  it.each([
    ['gAMA 1/2.2 only', [gama(1 / 2.2)]],
    ['gAMA 1/1.8 only', [gama(1 / 1.8)]],
    // Within 5 % of 1/2.2, browsers (libpng) treat gAMA as plain sRGB.
    ['gAMA 0.43 only', [gama(0.43)]],
    ['gAMA 0.44 only', [gama(0.44)]],
    ['gAMA 0.47 only', [gama(0.47)]],
    ['gAMA 0.48 only', [gama(0.48)]],
    ['gAMA 1.0 only', [gama(1)]],
    ['gAMA 1/1.8 + cHRM (P3 primaries)', [gama(1 / 1.8), p3Chrm]],
    ['gAMA 1/2.2 + cHRM (P3 primaries)', [gama(1 / 2.2), p3Chrm]],
    ['cHRM only (P3 primaries)', [p3Chrm]],
    ['sRGB + gAMA 1/1.8 (sRGB wins)', [{ type: 'sRGB', data: new Uint8Array([0]) }, gama(1 / 1.8)]],
  ] as const)('PNG with %s', async (label, chunks) => {
    const png = writePng({
      width: 64,
      height: 48,
      colorType: 2,
      depth: 8,
      samples: rgbSamples,
      chunks: [...chunks],
    });
    await expectSame(`PNG ${label}`, blob(png));
  });
});

// ---------- GIF ----------

const GIF_PALETTE: Array<[number, number, number]> = Array.from({ length: 256 }, (_, i) => [
  i,
  (i * 7) & 255,
  255 - i,
]);

describe('generated GIFs decode to the same first frame without a canvas', () => {
  const noise = (seed: number, colours: number) => {
    const rnd = random(seed);
    const cache = new Map<number, number>();
    return (x: number, y: number) => {
      const k = y * 4096 + x;
      let v = cache.get(k);
      if (v === undefined) {
        v = Math.floor(rnd() * colours);
        cache.set(k, v);
      }
      return v;
    };
  };
  const cases: Array<[string, GifSpec]> = [
    [
      '4 colours (2-bit codes)',
      {
        width: 30,
        height: 20,
        palette: GIF_PALETTE.slice(0, 4),
        frame: { width: 30, height: 20, index: (x, y) => ((x >> 2) + (y >> 2)) % 4 },
      },
    ],
    [
      '256-colour noise (full dictionary, clears)',
      {
        width: 160,
        height: 120,
        palette: GIF_PALETTE,
        frame: { width: 160, height: 120, index: noise(5, 256) },
      },
    ],
    [
      'interlaced',
      {
        width: 33,
        height: 27,
        palette: GIF_PALETTE.slice(0, 16),
        frame: { width: 33, height: 27, index: noise(6, 16), interlaced: true },
      },
    ],
    [
      'transparent index',
      {
        width: 24,
        height: 18,
        palette: GIF_PALETTE.slice(0, 8),
        frame: { width: 24, height: 18, index: noise(7, 8), transparent: 3 },
      },
    ],
    [
      'local palette, frame offset inside the screen',
      {
        width: 40,
        height: 30,
        palette: GIF_PALETTE.slice(0, 2),
        frame: {
          left: 5,
          top: 7,
          width: 20,
          height: 12,
          index: noise(8, 32),
          localPalette: GIF_PALETTE.slice(100, 132),
        },
      },
    ],
    [
      'two frames (first one shown)',
      {
        width: 20,
        height: 20,
        palette: GIF_PALETTE.slice(0, 4),
        frame: { width: 20, height: 20, index: noise(9, 4) },
        secondFrame: true,
      },
    ],
  ];
  it.each(cases)('GIF %s', async (label, spec) => {
    await expectSame(`GIF ${label}`, blob(writeGif(spec)));
  });
});

// ---------- BMP ----------

describe('generated BMPs decode to the same pixels without a canvas', () => {
  const rnd = random(42);
  const values = new Map<string, number>();
  const value = (key: string, bits: number) => {
    let v = values.get(key);
    if (v === undefined) {
      v = Math.floor(rnd() * 2 ** bits) >>> 0;
      values.set(key, v);
    }
    return v;
  };
  const px = (bits: number) => (x: number, y: number) => value(`${bits}:${x},${y}`, bits);
  const alphaPx = (x: number, y: number) => {
    const rgb = value(`a:${x},${y}`, 24);
    const a = [0, 255, 128, 3, 200][(x + y) % 5]!;
    return ((a << 24) | rgb) >>> 0;
  };
  const cases: Array<[string, BmpSpec]> = [
    [
      '1-bit palette',
      { width: 29, height: 13, bpp: 1, pixel: px(1), palette: GIF_PALETTE.slice(0, 2) },
    ],
    [
      '4-bit palette',
      { width: 29, height: 13, bpp: 4, pixel: px(4), palette: GIF_PALETTE.slice(0, 16) },
    ],
    ['8-bit palette', { width: 29, height: 13, bpp: 8, pixel: px(8), palette: GIF_PALETTE }],
    [
      '8-bit palette, OS/2 core header',
      { width: 29, height: 13, bpp: 8, pixel: px(8), palette: GIF_PALETTE, header: 12 },
    ],
    ['16-bit 5-5-5', { width: 29, height: 13, bpp: 16, pixel: px(15) }],
    [
      '16-bit 5-6-5 bit fields',
      { width: 29, height: 13, bpp: 16, pixel: px(16), masks: [0xf800, 0x07e0, 0x001f] },
    ],
    ['24-bit top-down', { width: 29, height: 13, bpp: 24, pixel: px(24), topDown: true }],
    ['32-bit, alpha bytes all zero', { width: 29, height: 13, bpp: 32, pixel: px(24) }],
    ['32-bit BI_RGB with alpha', { width: 29, height: 13, bpp: 32, pixel: alphaPx }],
    [
      '32-bit BI_RGB with alpha, v5 header',
      { width: 29, height: 13, bpp: 32, pixel: alphaPx, header: 124 },
    ],
    [
      '32-bit BI_RGB with alpha, v4 header',
      { width: 29, height: 13, bpp: 32, pixel: alphaPx, header: 108 },
    ],
    [
      '32-bit BI_ALPHABITFIELDS',
      {
        width: 29,
        height: 13,
        bpp: 32,
        pixel: alphaPx,
        masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
      },
    ],
    [
      '32-bit bit fields 10-10-10',
      {
        width: 29,
        height: 13,
        bpp: 32,
        pixel: px(30),
        masks: [0x3ff00000, 0x000ffc00, 0x000003ff],
      },
    ],
    [
      '32-bit v5 bit fields with alpha',
      {
        width: 29,
        height: 13,
        bpp: 32,
        pixel: alphaPx,
        header: 124,
        masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
      },
    ],
  ];
  it.each(cases)('BMP %s', async (label, spec) => {
    await expectSame(`BMP ${label}`, blob(writeBmp(spec)));
  });
});

// ---------- errors ----------

describe('broken files give the same readable error without a canvas', () => {
  it.each([
    ['text', new TextEncoder().encode('not an image at all')],
    ['truncated PNG', async () => (await fixture('images/opaque.png')).slice(0, 200)],
    ['truncated GIF', async () => (await fixture('images/sample.gif')).slice(0, 40)],
    ['truncated BMP', async () => (await fixture('images/sample.bmp')).slice(0, 100)],
    ['truncated WebP', async () => (await fixture('images/sample.webp')).slice(0, 60)],
    ['truncated JPEG', async () => (await fixture('images/orientation-1.jpg')).slice(0, 300)],
  ] as const)('%s', async (_label, make) => {
    const file = typeof make === 'function' ? await make() : blob(make);
    const reply = await withoutCanvas.decode(file);
    expect(reply).toMatchObject({ ok: false, canvas: false, code: 'unsupported' });
    expect(reply.error).toBe(decodeStrings.unsupported);
  });

  it('refuses a too-large PNG header the same way', async () => {
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, 20000);
    new DataView(ihdr.buffer).setUint32(4, 20000);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const png = concat([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
    ]);
    const reply = await withoutCanvas.decode(blob(png));
    expect(reply).toMatchObject({ ok: false, code: 'too-large' });
  });
});
