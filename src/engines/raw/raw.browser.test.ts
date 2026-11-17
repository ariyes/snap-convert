// P29: camera RAW through the image decoder, per brand fixture and per path (camera JPEG, full
// develop, half size, LibRaw fallback, errors). Needs `pnpm fixtures:raw`; skips with a message
// when the files aren't there. Decodes run in a worker (testing-worker.ts), like in the app.
import * as Comlink from 'comlink';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ssim } from '@/engines/image/quality';
import { timingLimit } from '../../../tests/support/timing';
import { RAW_MEMORY } from './plan';
import { rawStrings } from './strings';
import {
  deltaE2000,
  haveRawFixtures,
  MISSING_RAW_FIXTURES,
  neutralCells,
  rawFixture,
} from './testing';
import type { DecodeFailure, DecodeSummary, PixelSummary, RawTestApi } from './testing-worker';

const BRANDS = [
  // file, camera, developed size, has a full-size camera JPEG
  ['canon-1100d.cr2', 'Canon EOS 1100D', 4272, 2848, true],
  ['canon-m50.cr3', 'Canon EOS M50', 6000, 4000, true],
  ['nikon-d500.nef', 'Nikon D500', 5568, 3712, true],
  ['sony-a6400.arw', 'Sony ILCE-6400', 6000, 4000, false],
  ['ricoh-gr.dng', 'Ricoh GR', 4928, 3264, false],
  ['fuji-xs10.raf', 'Fujifilm X-S10', 6240, 4160, false],
  ['olympus-ep5.orf', 'Olympus E-P5', 4608, 3456, false],
  ['panasonic-g81.rw2', 'Panasonic DMC-G81', 4592, 3448, false],
  ['pentax-k5iis.pef', 'Pentax K-5 II s', 4928, 3264, true],
  ['samsung-nx500.srw', 'Samsung NX500', 6480, 4320, true],
] as const;

const ALL = [
  ...BRANDS.map((b) => b[0]),
  'canon-r8.cr3',
  'nikon-zf.nef',
  'ricoh-gr-portrait.dng',
  'pentax-k5iis-portrait.pef',
];

const have = await haveRawFixtures(...ALL);
if (!have) console.warn(MISSING_RAW_FIXTURES);

let worker: Worker;
let api: Comlink.Remote<RawTestApi>;
beforeAll(() => {
  worker = new Worker(new URL('./testing-worker.ts', import.meta.url), { type: 'module' });
  api = Comlink.wrap<RawTestApi>(worker);
});
afterAll(() => worker?.terminate());

async function file(name: string): Promise<File> {
  const f = await rawFixture(name);
  if (!f) throw new Error(MISSING_RAW_FIXTURES);
  return f;
}

function ok<T extends { ok: true }>(r: T | DecodeFailure): T {
  if (!r.ok) throw new Error(`decode failed: ${r.message}`);
  return r;
}

function pixelsOk(s: PixelSummary | DecodeSummary): void {
  expect(s.lumaStdDev, 'not a blank picture').toBeGreaterThan(8);
  expect(s.meanLuma).toBeGreaterThan(20);
  expect(s.meanLuma).toBeLessThan(235);
}

describe.skipIf(!have)('RAW files, one per brand', () => {
  describe.each(BRANDS)('%s', (name, camera, width, height, fullSizeJpeg) => {
    it('reads its details', async () => {
      const r = await api.info(await file(name));
      if (!r.ok) throw new Error(r.message);
      expect(r.info.camera).toBe(camera);
      expect([r.info.width, r.info.height]).toEqual([width, height]);
      expect(r.info.orientation).toBe(1);
      const sizes = r.info.previews.map((p) => p.width * p.height);
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a)); // largest first
    });

    it('fast: the camera JPEG when it is full size, otherwise a full develop', async () => {
      const s = ok(await api.decode(await file(name), { mode: 'fast' }));
      expect([s.width, s.height]).toEqual([width, height]);
      expect(s.sourceFormat).toBe('raw');
      expect(s.notes).toEqual(fullSizeJpeg ? ['raw-preview'] : []);
      expect(s.camera).toBe(camera);
      expect(s.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // The details fit a JPEG's EXIF segment (64 KB) even when the RAW's own block doesn't.
      expect(s.exifBytes ?? 0).toBeGreaterThan(100);
      expect(s.exifBytes ?? 0).toBeLessThan(65_000);
      pixelsOk(s);
    }, 120_000);

    it('full: develops the sensor data at full size', async () => {
      const s = ok(await api.decode(await file(name), { mode: 'full' }));
      expect([s.width, s.height]).toEqual([width, height]);
      expect(s.notes).toEqual([]);
      pixelsOk(s);
    }, 120_000);
  });
});

describe.skipIf(!have)('fast mode', () => {
  it('a CR3 with a full-size camera JPEG: < 1 s, and the output pixels are that JPEG', async () => {
    const f = await file('canon-m50.cr3');
    await api.decode(f, { mode: 'fast' }); // first RAW file: loads the engine and FlashRaw
    const s = ok(await api.decode(f, { mode: 'fast' }));
    expect(s.notes).toEqual(['raw-preview']);
    expect(s.ms).toBeLessThan(timingLimit(1000, 3000));
    const p = await api.preview(f);
    if (!p || 'message' in p) throw new Error('no camera JPEG');
    expect(p.stored).toEqual([6000, 4000]);
    expect([s.width, s.height]).toEqual([p.width, p.height]);
    expect(s.hash).toBe(p.hash);
  }, 120_000);

  it('develops instead when the full-size preview is not a JPEG (HEIF on an HDR Canon)', async () => {
    const s = ok(await api.decode(await file('canon-r8.cr3'), { mode: 'fast' }));
    expect(s.notes).toEqual([]);
    expect([s.width, s.height]).toEqual([6000, 4000]);
    pixelsOk(s);
  }, 120_000);

  it('a high-efficiency NEF (FlashRaw only) decodes both ways', async () => {
    const f = await file('nikon-zf.nef');
    const fast = ok(await api.decode(f, { mode: 'fast' }));
    expect(fast.notes).toEqual(['raw-preview']);
    const full = ok(await api.decode(f, { mode: 'full' }));
    expect([full.width, full.height]).toEqual([6048, 4032]);
    pixelsOk(full);
  }, 120_000);
});

describe.skipIf(!have)('full develop', () => {
  it('24 MP: as-shot white balance within ΔE 3 of LibRaw on neutral areas', async () => {
    const f = await file('sony-a6400.arw');
    const ours = ok(await api.decode(f, { mode: 'full' }));
    const lib = await api.libRaw(f, {
      whiteBalance: 'as-shot',
      exposure: 0,
      highlights: 'clip',
      halfSize: false,
    });
    if ('ok' in lib) throw new Error(lib.message);
    const cells = neutralCells(lib.lab, 48, 32, 12);
    expect(cells.length).toBe(12);
    const dE = cells.map((k) => deltaE2000(ours.lab[k]!, lib.lab[k]!));
    const mean = dE.reduce((a, b) => a + b, 0) / dE.length;
    expect(mean).toBeLessThan(3);
  }, 180_000);

  it('white balance auto, exposure and highlight recovery change the picture the right way', async () => {
    const f = await file('canon-1100d.cr2');
    const base = ok(await api.decode(f, { mode: 'full' }));
    const plus = ok(await api.decode(f, { mode: 'full', exposure: 1 }));
    const minus = ok(await api.decode(f, { mode: 'full', exposure: -1 }));
    expect(plus.meanLuma).toBeGreaterThan(base.meanLuma + 8);
    expect(minus.meanLuma).toBeLessThan(base.meanLuma - 8);
    const auto = ok(await api.decode(f, { mode: 'full', whiteBalance: 'auto' }));
    pixelsOk(auto);
    const recover = ok(await api.decode(f, { mode: 'full', highlights: 'recover' }));
    pixelsOk(recover);
    // Recovery compresses highlights more: never brighter on average.
    expect(recover.meanLuma).toBeLessThanOrEqual(base.meanLuma + 0.5);
  }, 240_000);

  it('portrait DNG comes out upright: the landscape develop turned 90° clockwise, pixel for pixel', async () => {
    const landscape = ok(
      await api.decode(await file('ricoh-gr.dng'), { mode: 'full' }, { orient: 6 }),
    );
    const portrait = ok(await api.decode(await file('ricoh-gr-portrait.dng'), { mode: 'full' }));
    expect([portrait.width, portrait.height]).toEqual([3264, 4928]);
    expect(portrait.orientation).toBe(6);
    expect(portrait.hash).toBe(landscape.orientedHash);
  }, 180_000);

  it('portrait PEF in fast mode: the camera JPEG is turned upright too', async () => {
    const landscape = ok(
      await api.decode(await file('pentax-k5iis.pef'), { mode: 'fast' }, { orient: 8 }),
    );
    const portrait = ok(
      await api.decode(await file('pentax-k5iis-portrait.pef'), { mode: 'fast' }),
    );
    expect(portrait.notes).toEqual(['raw-preview']);
    expect([portrait.width, portrait.height]).toEqual([3264, 4928]);
    expect(portrait.hash).toBe(landscape.orientedHash);
  }, 120_000);

  it('LibRaw (the fallback) develops alike and applies orientation itself', async () => {
    const f = await file('ricoh-gr-portrait.dng');
    const ours = ok(await api.decode(f, { mode: 'full' }));
    const lib = await api.libRaw(f, {
      whiteBalance: 'as-shot',
      exposure: 0,
      highlights: 'clip',
      halfSize: true,
    });
    if ('ok' in lib) throw new Error(lib.message);
    expect(lib.height).toBeGreaterThan(lib.width);
    pixelsOk(lib);
    const a = ours.thumb;
    const b = lib.thumb;
    if (a.width === b.width && a.height === b.height) expect(ssim(a, b)).toBeGreaterThan(0.8);
  }, 180_000);

  it('small outputs develop at half size as a reduced decode (no memory note)', async () => {
    const s = ok(
      await api.decode(await file('canon-m50.cr3'), { mode: 'full' }, { minLongestSide: 1200 }),
    );
    expect([s.width, s.height]).toEqual([3000, 2000]);
    expect(s.reducedFrom).toEqual({ width: 6000, height: 4000 });
    expect(s.notes).toEqual([]);
  }, 120_000);
});

describe.skipIf(!have)('memory', () => {
  it('a simulated phone develops at half size and says so', async () => {
    const s = ok(
      await api.decode(
        await file('sony-a6400.arw'),
        { mode: 'full' },
        { budget: RAW_MEMORY.phoneBudget },
      ),
    );
    expect([s.width, s.height]).toEqual([3000, 2000]);
    expect(s.notes).toEqual(['raw-half-size']);
    expect(s.reducedFrom).toBeUndefined();
    pixelsOk(s);
  }, 120_000);

  it('out of memory at full size: retried once at half size', async () => {
    const s = ok(
      await api.decode(await file('canon-1100d.cr2'), { mode: 'full' }, { failFullOnce: true }),
    );
    expect([s.width, s.height]).toEqual([2136, 1424]);
    expect(s.notes).toEqual(['raw-half-size']);
  }, 120_000);

  it('61 MP on a simulated phone: half size, no crash', async () => {
    const s = ok(
      await api.decode(
        await file('sony-a7r4-61mp.arw'),
        { mode: 'fast' },
        { budget: RAW_MEMORY.phoneBudget },
      ),
    );
    expect([s.width, s.height]).toEqual([4752, 3168]);
    expect(s.notes).toEqual(['raw-half-size']);
    pixelsOk(s);
  }, 180_000);
});

describe.skipIf(!have)('unsupported and damaged files', () => {
  it('a truncated RAW file: "This file looks damaged"', async () => {
    const whole = await file('canon-m50.cr3');
    const cut = new File([whole.slice(0, Math.floor(whole.size * 0.6))], 'cut.cr3');
    const r = await api.decode(cut, { mode: 'full' });
    expect(r).toMatchObject({ ok: false, message: rawStrings.damaged, code: 'damaged' });
  }, 120_000);

  it('garbage with a RAW name: "This file looks damaged"', async () => {
    const bytes = new Uint8Array(4096);
    bytes.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0]);
    for (let i = 8; i < bytes.length; i++) bytes[i] = (i * 7919) & 0xff;
    const r = await api.decode(new File([bytes], 'broken.nef'), { mode: 'fast' });
    expect(r).toMatchObject({ ok: false, message: rawStrings.damaged });
  }, 60_000);

  it('a compression no decoder knows: "This RAW format isn\'t supported yet (DNG)"', async () => {
    const bytes = new Uint8Array(await (await file('ricoh-gr.dng')).arrayBuffer());
    setRawCompression(bytes, 65000);
    const r = await api.decode(new File([bytes], 'odd.dng'), { mode: 'full' });
    expect(r).toMatchObject({
      ok: false,
      message: rawStrings.unsupportedFormat('DNG'),
      code: 'unsupported',
    });
  }, 120_000);
});

/** Sets the Compression tag of every lossless-JPEG image in a DNG's sub-IFDs. */
function setRawCompression(b: Uint8Array, value: number): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const le = b[0] === 0x49;
  const queue = [v.getUint32(4, le)];
  while (queue.length) {
    const at = queue.shift()!;
    const n = v.getUint16(at, le);
    for (let i = 0; i < n; i++) {
      const p = at + 2 + i * 12;
      const tag = v.getUint16(p, le);
      const count = v.getUint32(p + 4, le);
      if (tag === 0x014a) {
        if (count === 1) queue.push(v.getUint32(p + 8, le));
        else {
          const list = v.getUint32(p + 8, le);
          for (let k = 0; k < count; k++) queue.push(v.getUint32(list + 4 * k, le));
        }
      }
      if (tag === 0x0103 && v.getUint16(p + 8, le) === 7) v.setUint16(p + 8, value, le);
    }
  }
}
