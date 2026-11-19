/**
 * P06 encoder tests in real Chromium. Every encode runs inside a Web Worker (testing/harness.worker.ts),
 * the way the image worker (P12) will run it; test pictures are also made, decoded and scored there.
 * Pictures are generated (quality/testing/synthetic.ts) until P05's reference set lands; the governor
 * re-runs the crispness check on that set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImageFormat } from '@/core/contracts/image';
import { chromaSubsampling, parseJpeg, readFrame } from '../metadata';
import { ascii, buildExifTiff, concat, indexOf } from '../metadata/testing/builders';
import type { PictureSpec } from '../quality/testing/synthetic';
import { timingLimit } from '../../../../tests/support/timing';
import { browserJpeg, bytesOf, startHarness } from './testing/browser';

const { api, stop } = startHarness();
const report: string[] = [];
afterAll(() => {
  console.warn(`\nP06 encoder report\n${report.join('\n')}`);
  stop();
});

const LOSSY: ImageFormat[] = ['jpeg', 'webp', 'avif'];
let next = 0;

/** Makes a picture inside the worker and returns its id. */
async function make(spec: PictureSpec): Promise<string> {
  const id = `p${next++}`;
  await api.make(id, spec);
  return id;
}

/** The browser's JPEG encoder at 0.8 on a stored picture (run in the worker), plus its SSIM. */
async function canvasBaseline(id: string) {
  const blob = await api.browserJpeg(id, 0.8);
  return { blob, ssim: (await api.score(id, blob)).ssim };
}

async function jpegFrame(blob: Blob) {
  const frame = readFrame(parseJpeg(await bytesOf(blob)));
  return { chroma: chromaSubsampling(frame), progressive: frame.progressive };
}

describe('crispness at default quality 80 (D24)', () => {
  const pictures: Record<string, PictureSpec> = {
    'photo (landscape, fine detail)': {
      kind: 'scene',
      width: 1600,
      height: 1200,
      options: { seed: 11 },
    },
    'product on white': { kind: 'product', width: 1200, height: 1200 },
    'sky gradient': { kind: 'sky', width: 1600, height: 1000 },
    'text screenshot': { kind: 'text', width: 1200, height: 800 },
    'logo / line art': { kind: 'logo', width: 800, height: 800 },
  };

  beforeAll(() => {
    report.push(
      '',
      '| Picture | Format | Bytes | vs canvas JPEG 0.8 | SSIM |',
      '|---|---|---|---|---|',
    );
  });

  async function table(name: string, id: string) {
    const canvas = await canvasBaseline(id);
    report.push(
      `| ${name} | canvas.toBlob JPEG 0.8 | ${canvas.blob.size} | 100% | ${canvas.ssim.toFixed(4)} |`,
    );
    const scores: Record<string, number> = {};
    for (const format of LOSSY) {
      const { blob } = await api.encode(id, { format, quality: 80 });
      const { ssim } = await api.score(id, blob);
      scores[format] = ssim;
      const pct = ((blob.size / canvas.blob.size) * 100).toFixed(0);
      report.push(`| ${name} | ${format} | ${blob.size} | ${pct}% | ${ssim.toFixed(4)} |`);
    }
    await api.forget(id);
    return { canvas: canvas.ssim, scores };
  }

  it.each(Object.keys(pictures))('%s scores SSIM ≥ 0.97 in JPEG, WebP and AVIF', async (name) => {
    const { scores } = await table(name, await make(pictures[name]!));
    for (const format of LOSSY)
      expect(scores[format], `${name} as ${format}`).toBeGreaterThanOrEqual(0.97);
  });

  it('noisy night photo: no codec reaches 0.97 at 80 (SSIM counts lost grain); ours matches the browser', async () => {
    const id = await make({
      kind: 'scene',
      width: 1600,
      height: 1200,
      options: { seed: 13, brightness: 45, grain: 2.5 },
    });
    const { canvas, scores } = await table('night photo, heavy grain', id);
    for (const format of LOSSY) expect(scores[format]).toBeGreaterThan(canvas - 0.01);
  });
});

describe('JPEG vs the browser’s own encoder', () => {
  it('the worker baseline (OffscreenCanvas) is byte-identical to canvas.toBlob', async () => {
    const id = await make({ kind: 'scene', width: 640, height: 480, options: { seed: 15 } });
    const fromWorker = await bytesOf(await api.browserJpeg(id, 0.8));
    const fromCanvas = await bytesOf(await browserJpeg(await api.pixels(id), 0.8));
    expect(fromWorker).toEqual(fromCanvas);
  });

  it(
    '4000×3000 photo at quality 80 is ≥ 15% smaller than canvas.toBlob(0.8) at equal SSIM',
    { timeout: 120_000 },
    async () => {
      const id = await make({ kind: 'scene', width: 4000, height: 3000, options: { seed: 11 } });
      const canvas = await canvasBaseline(id);
      const { blob, ms } = await api.encode(id, { format: 'jpeg', quality: 80 });
      const ours = await api.score(id, blob);
      await api.forget(id);
      const saved = 1 - blob.size / canvas.blob.size;
      report.push(
        '',
        `12 MP photo: canvas.toBlob 0.8 = ${canvas.blob.size} B, SSIM ${canvas.ssim.toFixed(4)}; ` +
          `mozjpeg 80 = ${blob.size} B (${(saved * 100).toFixed(1)}% smaller), SSIM ${ours.ssim.toFixed(4)}, ` +
          `encode ${ms.toFixed(0)} ms, SSIM scoring ${ours.ssimMs.toFixed(0)} ms`,
      );
      expect(saved).toBeGreaterThanOrEqual(0.15);
      // "Equal": within 0.001 (the 4th decimal of SSIM is noise at this size).
      expect(ours.ssim).toBeGreaterThanOrEqual(canvas.ssim - 0.001);
      expect(ours.ssimMs).toBeLessThan(1000); // 12 MP SSIM in a worker in under 1 s
    },
  );
});

describe('graphic detection and chroma subsampling', () => {
  it.each([
    ['text screenshot', { kind: 'text', width: 1000, height: 700 }, true],
    ['logo', { kind: 'logo', width: 600, height: 600 }, true],
    ['photo', { kind: 'scene', width: 800, height: 600, options: { seed: 4 } }, false],
    ['product on white', { kind: 'product', width: 600, height: 600 }, false],
    ['sky gradient', { kind: 'sky', width: 800, height: 500 }, false],
  ] as const)('%s: graphic=%s → JPEG chroma follows', async (_, spec, graphic) => {
    const id = await make(spec);
    expect((await api.isGraphic(id)).graphic).toBe(graphic);
    const { blob } = await api.encode(id, { format: 'jpeg', quality: 80 });
    expect(await jpegFrame(blob)).toEqual({
      chroma: graphic ? '4:4:4' : '4:2:0',
      progressive: true,
    });
    await api.forget(id);
  });

  it('uses 4:4:4 for photos at quality 90+, and baseline when progressive is off', async () => {
    const id = await make({ kind: 'scene', width: 400, height: 300, options: { seed: 5 } });
    expect(
      (await jpegFrame((await api.encode(id, { format: 'jpeg', quality: 92 })).blob)).chroma,
    ).toBe('4:4:4');
    const baseline = (await api.encode(id, { format: 'jpeg', quality: 80, progressive: false }))
      .blob;
    expect((await jpegFrame(baseline)).progressive).toBe(false);
  });

  it('accepts a precomputed graphic hint (skips detection)', async () => {
    const id = await make({ kind: 'scene', width: 400, height: 300, options: { seed: 6 } });
    const { blob } = await api.encode(id, { format: 'jpeg', quality: 80 }, { graphic: true });
    expect((await jpegFrame(blob)).chroma).toBe('4:4:4');
  });

  it('isGraphic on a 12 MP image takes well under 100 ms', { timeout: 60_000 }, async () => {
    const id = await make({
      kind: 'scene',
      width: 4000,
      height: 3000,
      options: { seed: 7, detail: 0.5 },
    });
    const r = await api.isGraphic(id);
    await api.forget(id);
    expect(r.graphic).toBe(false);
    expect(r.ms).toBeLessThan(timingLimit(100, 500));
  });
});

describe('gradient banding', () => {
  it.each(LOSSY)('%s at 80: no luma step above 3 levels', async (format) => {
    const id = await make({ kind: 'sky', width: 1600, height: 1000 });
    const { blob } = await api.encode(id, { format, quality: 80 });
    const s = await api.steps(blob);
    report.push(
      `gradient ${format}: max luma step ${s.luma.toFixed(2)}, max single-channel step ${s.rgb}`,
    );
    expect(s.luma).toBeLessThanOrEqual(3);
    // The source steps by at most 1. YCbCr→RGB rounding alone gives R/B steps of 4
    // (even JPEG at quality 100 and the browser's own encoder do); more would be banding.
    expect(s.rgb).toBeLessThanOrEqual(4);
  });
});

describe('PNG', () => {
  it('is lossless: an opaque photo decodes to identical pixels', async () => {
    const id = await make({ kind: 'scene', width: 600, height: 400, options: { seed: 8 } });
    const { blob } = await api.encode(id, { format: 'png', quality: 10 });
    expect(blob.type).toBe('image/png');
    expect((await api.decode(blob)).data).toEqual((await api.pixels(id)).data);
  });

  it('is lossless with transparency: alpha identical, colour identical where opaque', async () => {
    const id = await make({ kind: 'logo', width: 300, height: 300, transparent: true });
    const src = (await api.pixels(id)).data;
    const out = (await api.decode((await api.encode(id, { format: 'png', quality: 80 })).blob))
      .data;
    let alphaDiff = 0;
    let colourDiff = 0;
    for (let i = 0; i < out.length; i += 4) {
      alphaDiff = Math.max(alphaDiff, Math.abs(out[i + 3]! - src[i + 3]!));
      if (src[i + 3] === 255) {
        for (let c = 0; c < 3; c++)
          colourDiff = Math.max(colourDiff, Math.abs(out[i + c]! - src[i + c]!));
      }
    }
    expect(alphaDiff).toBe(0);
    expect(colourDiff).toBe(0);
  });
});

describe('transparency', () => {
  it.each(['webp', 'avif'] as const)('%s keeps the alpha channel', async (format) => {
    const id = await make({ kind: 'logo', width: 400, height: 400, transparent: true });
    const src = (await api.pixels(id)).data;
    const out = (await api.decode((await api.encode(id, { format, quality: 80 })).blob)).data;
    let total = 0;
    let worst = 0;
    for (let i = 3; i < out.length; i += 4) {
      const d = Math.abs(out[i]! - src[i]!);
      total += d;
      worst = Math.max(worst, d);
    }
    expect(out[3]).toBe(0); // the transparent corner stays transparent
    expect(total / (out.length / 4)).toBeLessThan(1);
    expect(worst).toBeLessThan(64);
  });

  it('JPEG puts transparent pixels on the background colour (default white)', async () => {
    const id = await make({ kind: 'logo', width: 200, height: 200, transparent: true });
    const red = await api.decode(
      (await api.encode(id, { format: 'jpeg', quality: 90, background: '#ff0000' })).blob,
    );
    const white = await api.decode((await api.encode(id, { format: 'jpeg', quality: 90 })).blob);
    expect(Array.from(red.data.subarray(0, 3)).map((v) => Math.round(v / 8))).toEqual([32, 0, 0]);
    expect(Array.from(white.data.subarray(0, 3))).toEqual([255, 255, 255]);
  });
});

describe('metadata in real encoder output', () => {
  it.each(['jpeg', 'png', 'webp', 'avif'] as const)(
    '%s: encoder output carries no EXIF or XMP',
    async (format) => {
      const id = await make({ kind: 'scene', width: 300, height: 200, options: { seed: 9 } });
      const bytes = await bytesOf((await api.encode(id, { format, quality: 80 })).blob);
      expect(indexOf(bytes, ascii('Exif'))).toBe(-1);
      expect(indexOf(bytes, ascii('eXIf'))).toBe(-1);
      expect(indexOf(bytes, ascii('http://ns.adobe.com/xap'))).toBe(-1);
      expect(indexOf(bytes, ascii('<x:xmpmeta'))).toBe(-1);
    },
  );

  it('keep-all / strip-location / strip-all on a real JPEG; browsers still show it upright', async () => {
    const id = await make({ kind: 'scene', width: 320, height: 200, options: { seed: 10 } }); // landscape: rotation would show
    const { blob } = await api.encode(id, { format: 'jpeg', quality: 80 });
    const meta = {
      orientation: 6,
      hasLocation: true,
      exif: concat(ascii('Exif\0\0'), buildExifTiff({ orientation: 6, gps: true, thumbnail: true }))
        .buffer,
    };
    for (const policy of ['keep-all', 'strip-location', 'strip-all'] as const) {
      const r = await api.applyMetadata(blob, meta, policy);
      const bytes = await bytesOf(r.blob);
      const decoded = await createImageBitmap(r.blob); // honours EXIF orientation by default
      expect([decoded.width, decoded.height]).toEqual([320, 200]);
      decoded.close();
      expect(r.exifKept).toBe(policy !== 'strip-all');
      expect(indexOf(bytes, ascii('Exif')) >= 0).toBe(policy !== 'strip-all');
    }
  });

  it.each(['png', 'webp', 'avif'] as const)(
    '%s: keep-all returns the "JPG only" flag',
    async (format) => {
      const id = await make({ kind: 'scene', width: 100, height: 80, options: { seed: 12 } });
      const { blob } = await api.encode(id, { format, quality: 80 });
      const r = await api.applyMetadata(blob, { orientation: 1, hasLocation: false }, 'keep-all');
      expect(r.jpegOnly).toBe(true);
    },
  );
});

describe('limits and errors', () => {
  it('rejects a WebP wider than 16383 px with a readable typed error', async () => {
    const err = await api.encodeError(new ImageData(16_384, 1), { format: 'webp', quality: 80 });
    expect(err).toMatchObject({ name: 'ImageEncodeError', code: 'too-large' });
    expect(err?.message).toMatch(/too big to save as WebP/);
  });

  it('AVIF: a 12 MP photo encodes in under 15 s', { timeout: 60_000 }, async () => {
    const env = await api.environment();
    const id = await make({ kind: 'scene', width: 4000, height: 3000, options: { seed: 14 } });
    const { blob, ms } = await api.encode(id, { format: 'avif', quality: 80 });
    await api.forget(id);
    report.push(
      `12 MP AVIF: ${blob.size} B in ${ms.toFixed(0)} ms (threads: ${env.threads ? 'yes' : 'no — test page not cross-origin isolated'})`,
    );
    expect(ms).toBeLessThan(timingLimit(15_000, 45_000));
  });
});
