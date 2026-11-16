/**
 * P06 encoder tests in real Chromium. Every encode runs inside a Web Worker (testing/harness.worker.ts),
 * the way the image worker (P12) will run it. Pictures are generated (see quality/testing/synthetic.ts)
 * until P05's reference set lands; the governor re-runs the crispness check on that set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImageFormat } from '@/core/contracts/image';
import { chromaSubsampling, parseJpeg, readFrame } from '../metadata';
import { ascii, buildExifTiff, concat, indexOf } from '../metadata/testing/builders';
import { ssim } from '../quality';
import type { Pixels } from '../quality/pixels';
import {
  logoArt,
  photoScene,
  productOnWhite,
  skyGradient,
  textScreenshot,
  type TestImage,
} from '../quality/testing/synthetic';
import { browserJpeg, bytesOf, decodeBlob, startHarness, toImageData } from './testing/browser';

const { api, stop } = startHarness();
const report: string[] = [];
afterAll(() => {
  console.warn(`\nP06 encoder report\n${report.join('\n')}`);
  stop();
});

const LOSSY: ImageFormat[] = ['jpeg', 'webp', 'avif'];

/** BT.601 luma steps between neighbours (what the eye sees as banding), and the largest RGB step. */
function steps(img: Pixels): { luma: number; rgb: number } {
  const { width, height, data } = img;
  const L = (p: number) => 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
  let luma = 0;
  let rgb = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      for (const q of [x + 1 < width ? p + 4 : -1, y + 1 < height ? p + width * 4 : -1]) {
        if (q < 0) continue;
        luma = Math.max(luma, Math.abs(L(p) - L(q)));
        for (let c = 0; c < 3; c++) rgb = Math.max(rgb, Math.abs(data[p + c]! - data[q + c]!));
      }
    }
  }
  return { luma, rgb };
}

async function jpegChroma(blob: Blob) {
  const frame = readFrame(parseJpeg(await bytesOf(blob)));
  return { chroma: chromaSubsampling(frame), progressive: frame.progressive };
}

describe('crispness at default quality 80 (D24)', () => {
  const pictures: Record<string, () => TestImage> = {
    'photo (landscape, fine detail)': () => photoScene(1600, 1200, { seed: 11 }),
    'product on white': () => productOnWhite(1200, 1200),
    'sky gradient': () => skyGradient(1600, 1000),
    'text screenshot': () => textScreenshot(1200, 800),
    'logo / line art': () => logoArt(800, 800),
  };

  beforeAll(() => {
    report.push(
      '',
      '| Picture | Format | Bytes | vs canvas JPEG 0.8 | SSIM |',
      '|---|---|---|---|---|',
    );
  });

  it.each(Object.keys(pictures))('%s scores SSIM ≥ 0.97 in JPEG, WebP and AVIF', async (name) => {
    const img = toImageData(pictures[name]!());
    const canvas = await browserJpeg(img, 0.8);
    const canvasSsim = ssim(img, await decodeBlob(canvas));
    report.push(
      `| ${name} | canvas.toBlob JPEG 0.8 | ${canvas.size} | 100% | ${canvasSsim.toFixed(4)} |`,
    );
    for (const format of LOSSY) {
      const { blob } = await api.encode(img, { format, quality: 80 });
      const score = ssim(img, await decodeBlob(blob));
      report.push(
        `| ${name} | ${format} | ${blob.size} | ${((blob.size / canvas.size) * 100).toFixed(0)}% | ${score.toFixed(4)} |`,
      );
      expect(score, `${name} as ${format}`).toBeGreaterThanOrEqual(0.97);
    }
  });

  it('noisy night photo: no codec reaches 0.97 at 80 (SSIM punishes lost grain); ours stays at the browser’s level', async () => {
    const img = toImageData(photoScene(1600, 1200, { seed: 13, brightness: 45, grain: 2.5 }));
    const canvas = await browserJpeg(img, 0.8);
    const canvasSsim = ssim(img, await decodeBlob(canvas));
    report.push(
      `| night photo, heavy grain | canvas.toBlob JPEG 0.8 | ${canvas.size} | 100% | ${canvasSsim.toFixed(4)} |`,
    );
    for (const format of LOSSY) {
      const { blob } = await api.encode(img, { format, quality: 80 });
      const score = ssim(img, await decodeBlob(blob));
      report.push(
        `| night photo, heavy grain | ${format} | ${blob.size} | ${((blob.size / canvas.size) * 100).toFixed(0)}% | ${score.toFixed(4)} |`,
      );
      expect(score).toBeGreaterThan(canvasSsim - 0.01);
    }
  });
});

describe('JPEG vs the browser’s own encoder', () => {
  it(
    '4000×3000 photo at quality 80 is ≥ 15% smaller than canvas.toBlob(0.8) at equal SSIM',
    { timeout: 120_000 },
    async () => {
      const img = toImageData(photoScene(4000, 3000, { seed: 11 }));
      const canvas = await browserJpeg(img, 0.8);
      const canvasScore = (await api.ssim(img, await decodeBlob(canvas))).score;
      const { blob, ms } = await api.encode(img, { format: 'jpeg', quality: 80 });
      const ours = await api.ssim(img, await decodeBlob(blob));
      const saved = 1 - blob.size / canvas.size;
      report.push(
        '',
        `12 MP photo: canvas.toBlob 0.8 = ${canvas.size} B, SSIM ${canvasScore.toFixed(4)}; ` +
          `mozjpeg 80 = ${blob.size} B (${(saved * 100).toFixed(1)}% smaller), SSIM ${ours.score.toFixed(4)}, ` +
          `encode ${ms.toFixed(0)} ms, SSIM scoring ${ours.ms.toFixed(0)} ms`,
      );
      expect(saved).toBeGreaterThanOrEqual(0.15);
      // "Equal": within 0.001 (the 4th decimal of SSIM is noise at this size).
      expect(ours.score).toBeGreaterThanOrEqual(canvasScore - 0.001);
      expect(ours.ms).toBeLessThan(1000); // 12 MP SSIM in a worker in under 1 s
    },
  );
});

describe('graphic detection and chroma subsampling', () => {
  it.each([
    ['text screenshot', () => textScreenshot(1000, 700), true],
    ['logo', () => logoArt(600, 600), true],
    ['photo', () => photoScene(800, 600, { seed: 4 }), false],
    ['product on white', () => productOnWhite(600, 600), false],
    ['sky gradient', () => skyGradient(800, 500), false],
  ] as const)('%s: graphic=%s → JPEG chroma follows', async (_, make, graphic) => {
    const img = toImageData(make());
    expect((await api.isGraphic(img)).graphic).toBe(graphic);
    const { blob } = await api.encode(img, { format: 'jpeg', quality: 80 });
    expect(await jpegChroma(blob)).toEqual({
      chroma: graphic ? '4:4:4' : '4:2:0',
      progressive: true,
    });
  });

  it('uses 4:4:4 for photos at quality 90+, and baseline when progressive is off', async () => {
    const img = toImageData(photoScene(400, 300, { seed: 5 }));
    expect(
      (await jpegChroma((await api.encode(img, { format: 'jpeg', quality: 92 })).blob)).chroma,
    ).toBe('4:4:4');
    const baseline = (await api.encode(img, { format: 'jpeg', quality: 80, progressive: false }))
      .blob;
    expect((await jpegChroma(baseline)).progressive).toBe(false);
  });

  it('accepts a precomputed graphic hint (skips detection)', async () => {
    const img = toImageData(photoScene(400, 300, { seed: 6 }));
    const { blob } = await api.encode(img, { format: 'jpeg', quality: 80 }, { graphic: true });
    expect((await jpegChroma(blob)).chroma).toBe('4:4:4');
  });

  it('isGraphic on a 12 MP image takes well under 100 ms', async () => {
    const img = toImageData(photoScene(4000, 3000, { seed: 7, detail: 0.5 }));
    const r = await api.isGraphic(img);
    expect(r.graphic).toBe(false);
    expect(r.ms).toBeLessThan(100);
  });
});

describe('gradient banding', () => {
  it.each(LOSSY)('%s at 80: no luma step above 3 levels', async (format) => {
    const img = toImageData(skyGradient(1600, 1000));
    expect(steps(img)).toEqual({ luma: expect.any(Number) as number, rgb: 1 });
    const { blob } = await api.encode(img, { format, quality: 80 });
    const s = steps(await decodeBlob(blob));
    report.push(
      `gradient ${format}: max luma step ${s.luma.toFixed(2)}, max single-channel step ${s.rgb}`,
    );
    expect(s.luma).toBeLessThanOrEqual(3);
    // YCbCr→RGB rounding alone gives R/B steps of up to 4 (even JPEG at 100 does); more is banding.
    expect(s.rgb).toBeLessThanOrEqual(5);
  });
});

describe('PNG', () => {
  it('is lossless: an opaque photo decodes to identical pixels', async () => {
    const img = toImageData(photoScene(600, 400, { seed: 8 }));
    const { blob } = await api.encode(img, { format: 'png', quality: 10 });
    expect(blob.type).toBe('image/png');
    expect((await decodeBlob(blob)).data).toEqual(img.data);
  });

  it('is lossless with transparency: alpha identical, colour identical where opaque', async () => {
    const img = toImageData(logoArt(300, 300, true));
    const { blob } = await api.encode(img, { format: 'png', quality: 80 });
    const out = (await decodeBlob(blob)).data;
    let alphaDiff = 0;
    let colourDiff = 0;
    for (let i = 0; i < out.length; i += 4) {
      alphaDiff = Math.max(alphaDiff, Math.abs(out[i + 3]! - img.data[i + 3]!));
      if (img.data[i + 3] === 255) {
        for (let c = 0; c < 3; c++)
          colourDiff = Math.max(colourDiff, Math.abs(out[i + c]! - img.data[i + c]!));
      }
    }
    expect(alphaDiff).toBe(0);
    expect(colourDiff).toBe(0);
  });
});

describe('transparency', () => {
  it.each(['webp', 'avif'] as const)('%s keeps the alpha channel', async (format) => {
    const img = toImageData(logoArt(400, 400, true));
    const { blob } = await api.encode(img, { format, quality: 80 });
    const out = (await decodeBlob(blob)).data;
    let total = 0;
    let worst = 0;
    for (let i = 3; i < out.length; i += 4) {
      const d = Math.abs(out[i]! - img.data[i]!);
      total += d;
      worst = Math.max(worst, d);
    }
    expect(out[3]).toBe(0); // the transparent corner stays transparent
    expect(total / (out.length / 4)).toBeLessThan(1);
    expect(worst).toBeLessThan(64);
  });

  it('JPEG puts transparent pixels on the background colour (default white)', async () => {
    const img = toImageData(logoArt(200, 200, true));
    const red = await decodeBlob(
      (await api.encode(img, { format: 'jpeg', quality: 90, background: '#ff0000' })).blob,
    );
    const white = await decodeBlob((await api.encode(img, { format: 'jpeg', quality: 90 })).blob);
    expect(Array.from(red.data.subarray(0, 3)).map((v) => Math.round(v / 8))).toEqual([32, 0, 0]);
    expect(Array.from(white.data.subarray(0, 3))).toEqual([255, 255, 255]);
  });
});

describe('metadata in real encoder output', () => {
  const formats: ImageFormat[] = ['jpeg', 'png', 'webp', 'avif'];

  it.each(formats)('%s: encoder output carries no EXIF or XMP', async (format) => {
    const img = toImageData(photoScene(300, 200, { seed: 9 }));
    const bytes = await bytesOf((await api.encode(img, { format, quality: 80 })).blob);
    expect(indexOf(bytes, ascii('Exif'))).toBe(-1);
    expect(indexOf(bytes, ascii('eXIf'))).toBe(-1);
    expect(indexOf(bytes, ascii('http://ns.adobe.com/xap'))).toBe(-1);
    expect(indexOf(bytes, ascii('<x:xmpmeta'))).toBe(-1);
  });

  it('keep-all / strip-location / strip-all on a real JPEG; browsers still decode it upright', async () => {
    const img = toImageData(photoScene(320, 200, { seed: 10 })); // landscape: rotation would show
    const { blob } = await api.encode(img, { format: 'jpeg', quality: 80 });
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
      const img = toImageData(photoScene(100, 80, { seed: 12 }));
      const { blob } = await api.encode(img, { format, quality: 80 });
      const r = await api.applyMetadata(blob, { orientation: 1, hasLocation: false }, 'keep-all');
      expect(r.jpegOnly).toBe(true);
    },
  );
});

describe('limits and errors', () => {
  it('rejects a WebP wider than 16383 px with a readable typed error', async () => {
    const img = new ImageData(16_384, 1);
    const err = await api.encodeError(img, { format: 'webp', quality: 80 });
    expect(err).toMatchObject({ name: 'ImageEncodeError', code: 'too-large' });
    expect(err?.message).toMatch(/too big to save as WebP/);
  });

  it('AVIF: a 12 MP photo encodes in under 15 s', { timeout: 60_000 }, async () => {
    const env = await api.environment();
    const img = toImageData(photoScene(4000, 3000, { seed: 14 }));
    const { blob, ms } = await api.encode(img, { format: 'avif', quality: 80 });
    report.push(
      `12 MP AVIF: ${blob.size} B in ${ms.toFixed(0)} ms (threads: ${env.threads ? 'yes' : 'no — page not cross-origin isolated'})`,
    );
    expect(ms).toBeLessThan(15_000);
  });
});
