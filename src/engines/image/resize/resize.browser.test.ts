import { afterAll, describe, expect, it } from 'vitest';
import { fixture, pixelAt } from '../decode/test-utils';
import { resizePixels } from './index';
import type {
  GradientResult,
  LineArtResult,
  ReferenceResult,
  ResizeJob,
  TextResult,
  TimingResult,
} from './testing-worker';

// Big images are resized and measured in a worker (see testing-worker.ts) so this page's main
// thread stays free; the small cases below run here.

function startWorker() {
  const worker = new Worker(new URL('./testing-worker.ts', import.meta.url), { type: 'module' });
  let next = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (
    e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>,
  ) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (e.data.ok) p?.resolve(e.data.result);
    else p?.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message));
    pending.clear();
  };
  return {
    call<T>(job: ResizeJob): Promise<T> {
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: (v) => resolve(v as T), reject });
        worker.postMessage({ id, job });
      });
    },
    stop: () => worker.terminate(),
  };
}

const shared = startWorker();
afterAll(() => shared.stop());

describe('resizePixels basics', () => {
  it('returns exactly the requested size', async () => {
    const src = new ImageData(300, 200);
    src.data.fill(200);
    const out = await resizePixels(src, { width: 97, height: 61 });
    expect([out.width, out.height, out.data.length]).toEqual([97, 61, 97 * 61 * 4]);
    expect(pixelAt(out, 50, 30)).toEqual([200, 200, 200, 200]);
  });

  it('returns the input unchanged when the size is the same', async () => {
    const src = new ImageData(10, 10);
    expect(await resizePixels(src, { width: 10, height: 10 })).toBe(src);
  });

  it('rejects invalid sizes', async () => {
    const src = new ImageData(10, 10);
    await expect(resizePixels(src, { width: 0, height: 5 })).rejects.toThrow(RangeError);
    await expect(resizePixels(src, { width: 5.5, height: 5 })).rejects.toThrow(RangeError);
  });

  it('enlarges when asked (upscale is the caller’s decision)', async () => {
    const src = new ImageData(10, 10);
    src.data.fill(255);
    const out = await resizePixels(src, { width: 25, height: 25 });
    expect([out.width, out.height]).toEqual([25, 25]);
    expect(pixelAt(out, 12, 12)).toEqual([255, 255, 255, 255]);
  });

  it('handles a view into a larger buffer', async () => {
    const backing = new Uint8ClampedArray(8 + 20 * 20 * 4).fill(90);
    const src = new ImageData(new Uint8ClampedArray(backing.buffer, 8, 20 * 20 * 4), 20, 20);
    const out = await resizePixels(src, { width: 10, height: 10 });
    expect(pixelAt(out, 5, 5)).toEqual([90, 90, 90, 90]);
  });

  it('does not darken colours next to transparent pixels', async () => {
    // Opaque orange next to fully transparent black: correct (premultiplied) resampling keeps the orange.
    const src = new ImageData(40, 10);
    for (let y = 0; y < 10; y++) {
      for (let x = 20; x < 40; x++) src.data.set([255, 128, 0, 255], (y * 40 + x) * 4);
    }
    const out = await resizePixels(src, { width: 13, height: 3 });
    for (let x = 0; x < 13; x++) {
      const [r, g, , a] = pixelAt(out, x, 1);
      if (a > 32) {
        expect(r).toBeGreaterThan(235);
        expect(Math.abs(g - 128)).toBeLessThan(20);
      }
    }
  });
});

describe('performance', () => {
  it('resizes 4000×3000 → 1000×750 in a worker in under 1.5 s', async () => {
    const fresh = startWorker(); // so the first run includes loading pica
    try {
      const result = await fresh.call<TimingResult>({
        kind: 'timing',
        width: 4000,
        height: 3000,
        toWidth: 1000,
        toHeight: 750,
        runs: 3,
      });
      expect([result.width, result.height]).toEqual([1000, 750]);
      for (const ms of result.timings) expect(ms).toBeLessThan(1500);
    } finally {
      fresh.stop();
    }
  }, 30_000);
});

describe('crispness on line art (image quality standard, D24)', () => {
  const lineArt = async (ratio: number) =>
    shared.call<LineArtResult>({
      kind: 'line-art',
      file: await fixture('quality/line-art-logo.png'),
      ratio,
    });

  it.each([1.25, 1.5, 2, 2.5, 3, 4, 6, 8, 12])(
    '%s× reduction',
    async (ratio) => {
      const r = await lineArt(ratio);
      // Sharper than plain bilinear.
      expect(r.edge).toBeGreaterThan(r.edgeBilinear * 1.1);
      // No halo wider than 1 px around the mid-grey square (overshoot > 3 levels counts).
      for (const width of [...r.haloRows, ...r.haloColumns]) expect(width).toBeLessThanOrEqual(1);
      // 1 px lines are finer than the smaller image can show: flat grey, no moiré. Just above 1×,
      // they fall in every practical filter's transition band; there Lanczos3 must still beat bilinear.
      if (ratio >= 1.4) expect(r.grating).toBeLessThan(3);
      else expect(r.grating).toBeLessThan(r.gratingBilinear * 1.05);
      // Zone plate rings above the output's limit fade to grey instead of false rings.
      if (ratio >= 2) {
        expect(r.zone).toBeLessThan(10);
        expect(r.zone).toBeLessThan(r.zoneNaive / 3);
      }
    },
    60_000,
  );

  it.each([1.1, 1.33])(
    '%s× reduction: less moiré than bilinear on the 1 px grating',
    async (ratio) => {
      const r = await lineArt(ratio);
      expect(r.grating).toBeLessThan(r.gratingBilinear * 1.05);
    },
    60_000,
  );

  it('applies no sharpening below 1.25×', async () => {
    expect((await lineArt(1.2)).equalsUnsharpened).toBe(true);
    expect((await lineArt(2)).equalsUnsharpened).toBe(false);
  }, 60_000);
});

describe('crispness on text', () => {
  it.each([1.5, 2, 3, 4, 8])(
    '%s× reduction: sharper than plain bilinear',
    async (ratio) => {
      const r = await shared.call<TextResult>({
        kind: 'text',
        file: await fixture('quality/text-screenshot.png'),
        ratio,
      });
      expect(r.edge).toBeGreaterThan(r.edgeBilinear * 1.1);
    },
    60_000,
  );
});

describe('no banding in smooth gradients', () => {
  it.each([1.5, 3, 4.7])(
    'sky gradient survives decode + %s× resize with steps ≤ 2 levels',
    async (ratio) => {
      const r = await shared.call<GradientResult>({
        kind: 'gradient',
        file: await fixture('quality/sky-gradient.png'),
        ratio,
      });
      expect(r.sourceStep).toBeLessThanOrEqual(1);
      expect(r.step).toBeLessThanOrEqual(2);
    },
    60_000,
  );
});

describe('reference quality set', () => {
  it.each([
    ['photo-fine-detail.jpg', false],
    ['photo-night-noise.jpg', false],
    ['photo-product-on-white.jpg', false],
    ['photo-portrait-exif-rotated.jpg', true],
    ['sky-gradient.png', false],
    ['text-screenshot.png', false],
    ['line-art-logo.png', false],
  ] as const)(
    '%s: decodes upright and resizes to 800 px, sharper than bilinear',
    async (name, portrait) => {
      const r = await shared.call<ReferenceResult>({
        kind: 'reference',
        file: await fixture(`quality/${name}`),
        longestSide: 800,
      });
      expect(r.height > r.width).toBe(portrait);
      expect(Math.max(r.outWidth, r.outHeight)).toBe(800);
      if (name !== 'sky-gradient.png') expect(r.edge).toBeGreaterThan(r.edgeBilinear);
    },
    60_000,
  );
});
