// P12b: real image jobs through the real image worker in every Playwright browser — above all
// WebKit, whose workers on Windows have no OffscreenCanvas (like Safari before 16.4), so the
// engine's canvas-free decoders do all the work there.
//
// No page on main runs image jobs yet (the tool pages are being built), so the production build
// served by `vite preview` doesn't contain the image worker. This spec therefore bundles
// src/engines/image/worker.ts itself with Vite (production mode, like the app's worker bundle)
// into a temporary folder, serves it from its own local server with the same cross-origin
// isolation headers, and talks to it with Comlink's message protocol, as the job queue does.
// Once a tool spec on main runs image jobs, those cover the same ground through the UI.
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './support/test';
import { build } from 'vite';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

interface Harness {
  url: string;
  close: () => Promise<void>;
}

/** Bundles the image worker and serves it with a blank page. One per Playwright worker process. */
async function startHarness(): Promise<Harness> {
  const outDir = await mkdtemp(path.join(tmpdir(), 'snap-convert-image-engine-'));
  await build({
    configFile: false,
    root,
    base: './',
    logLevel: 'error',
    mode: 'production',
    resolve: { alias: { '@': path.join(root, 'src') } },
    worker: { format: 'es' },
    build: {
      outDir,
      emptyOutDir: true,
      modulePreload: false,
      copyPublicDir: false,
      rollupOptions: {
        input: { 'image-worker': path.join(root, 'src/engines/image/worker.ts') },
        output: { format: 'es', entryFileNames: '[name].js' },
      },
    },
  });
  await writeFile(path.join(outDir, 'index.html'), '<!doctype html><title>image engine</title>');
  const server: Server = createServer((req, res) => {
    void (async () => {
      const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(
        /^\/+/,
        '',
      );
      const file = path.resolve(outDir, rel || 'index.html');
      if (!file.startsWith(outDir)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(outDir, { recursive: true, force: true });
    },
  };
}

let harness: Harness | undefined;
// The engine bundle is served by this spec's own local server (not the app): let the guard pass it.
test.use({ allowRequests: [/^http:\/\/127\.0\.0\.1:\d+\//] });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  harness = await startHarness();
});
test.afterAll(async () => {
  await harness?.close();
});

interface JobOutcome {
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  format?: string;
  ssim?: number;
  notes?: string[];
  /** RGBA of a few result pixels, decoded on the page (main thread) when the browser can. */
  samples?: number[][];
}

/** Runs one job in a fresh image worker on the page, via Comlink's APPLY message. */
async function runJob(
  page: Page,
  fixture: string,
  input: Record<string, unknown>,
  sampleAt: Array<[number, number]> = [],
): Promise<JobOutcome> {
  const base64 = readFileSync(path.join(root, 'tests/fixtures', fixture)).toString('base64');
  return page.evaluate(
    async ({ base64, input, sampleAt, name }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const worker = new Worker('./image-worker.js', { type: 'module' });
      try {
        const reply = await new Promise<{ type: string; name?: string; value: unknown }>(
          (resolve, reject) => {
            worker.onmessage = (e: MessageEvent<{ type: string; name?: string; value: unknown }>) =>
              resolve(e.data);
            worker.onerror = (e) => reject(new Error(e.message));
            const job = { ...input, file: new Blob([bytes]), name };
            worker.postMessage({
              id: 'job',
              type: 'APPLY',
              path: ['run'],
              argumentList: [
                { type: 'RAW', value: 'process' },
                { type: 'RAW', value: job },
                { type: 'RAW', value: undefined },
              ],
            });
          },
        );
        if (reply.type === 'HANDLER' && reply.name === 'throw') {
          const thrown = reply.value as { value?: { message?: string } };
          return { ok: false, error: thrown.value?.message ?? 'error' };
        }
        const result = reply.value as {
          blob: Blob;
          width: number;
          height: number;
          format: string;
          ssim: number;
          notes: string[];
        };
        let samples: number[][] | undefined;
        try {
          const bitmap = await createImageBitmap(result.blob);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          samples = sampleAt.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
        } catch {
          samples = undefined; // e.g. no AVIF decoder on this page
        }
        return {
          ok: true,
          width: result.width,
          height: result.height,
          format: result.format,
          ssim: result.ssim,
          notes: result.notes,
          samples,
        };
      } finally {
        worker.terminate();
      }
    },
    { base64, input, sampleAt, name: path.basename(fixture) },
  );
}

const close = (a: number[] | undefined, b: number[], tolerance = 40) =>
  !!a && b.every((v, i) => Math.abs((a[i] ?? -999) - v) <= tolerance);

const base = { format: 'jpeg', quality: 80, metadata: 'strip-all' };

test.describe('image engine in this browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(harness!.url);
  });

  test('reports whether workers here have OffscreenCanvas', async ({ page, browserName }) => {
    const hasCanvas = await page.evaluate(async () => {
      const src = 'postMessage(typeof OffscreenCanvas === "function")';
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const value = await new Promise<boolean>((resolve) => {
        worker.onmessage = (e) => resolve(e.data as boolean);
      });
      worker.terminate();
      return value;
    });
    test.info().annotations.push({
      type: 'worker OffscreenCanvas',
      description: `${browserName}: ${hasCanvas ? 'yes (canvas path)' : 'no (canvas-free decoders)'}`,
    });
    if (browserName === 'chromium') expect(hasCanvas).toBe(true);
    // Playwright's WebKit on Windows is the reason for P12b: make sure this spec really runs the
    // canvas-free path there (if a WebKit update adds OffscreenCanvas, the fallback is still
    // covered by the Vitest suites that switch it off).
    if (browserName === 'webkit' && process.platform === 'win32') expect(hasCanvas).toBe(false);
  });

  test('EXIF-rotated JPEG → resized WebP comes out upright', async ({ page }) => {
    const r = await runJob(
      page,
      'images/orientation-6.jpg',
      { ...base, format: 'webp', qualityGuard: true, resize: { mode: 'longest', value: 48 } },
      [
        [3, 3],
        [44, 28],
      ],
    );
    expect(r.ok, r.error).toBe(true);
    expect([r.width, r.height, r.format]).toEqual([48, 32, 'webp']);
    expect(r.ssim).toBeGreaterThanOrEqual(0.95);
    if (r.samples) {
      expect(close(r.samples[0], [255, 0, 0])).toBe(true); // red top-left
      expect(close(r.samples[1], [255, 255, 0])).toBe(true); // yellow bottom-right
    }
  });

  test('transparent PNG → JPEG on the chosen background', async ({ page }) => {
    const r = await runJob(page, 'images/alpha.png', { ...base, background: 'navy' }, [
      [10, 30],
      [75, 30],
    ]);
    expect(r.ok, r.error).toBe(true);
    expect([r.width, r.height, r.format]).toEqual([90, 60, 'jpeg']);
    expect(close(r.samples?.[0], [0, 0, 128], 12)).toBe(true);
    expect(close(r.samples?.[1], [255, 64, 0], 12)).toBe(true);
  });

  test('transparent PNG → WebP keeps the alpha channel', async ({ page }) => {
    const r = await runJob(page, 'images/alpha.png', { ...base, format: 'webp' }, [[10, 30]]);
    expect(r.ok, r.error).toBe(true);
    expect(r.format).toBe('webp');
    expect(r.samples?.[0]?.[3]).toBe(0);
  });

  test('GIF → PNG and BMP → JPEG', async ({ page }) => {
    const gif = await runJob(page, 'images/sample.gif', { ...base, format: 'png' }, [[2, 2]]);
    expect(gif.ok, gif.error).toBe(true);
    expect([gif.width, gif.height, gif.format, gif.ssim]).toEqual([40, 30, 'png', 1]);
    expect(close(gif.samples?.[0], [255, 0, 0], 0)).toBe(true); // first frame, not the white one
    const bmp = await runJob(page, 'images/sample.bmp', base, [[3, 3]]);
    expect(bmp.ok, bmp.error).toBe(true);
    expect([bmp.width, bmp.height]).toEqual([50, 30]);
    expect(close(bmp.samples?.[0], [255, 0, 0])).toBe(true);
  });

  test('WebP → AVIF and AVIF → JPEG', async ({ page }) => {
    const avif = await runJob(page, 'images/sample.webp', { ...base, format: 'avif' });
    expect(avif.ok, avif.error).toBe(true);
    expect([avif.width, avif.height, avif.format]).toEqual([80, 60, 'avif']);
    expect(avif.ssim).toBeGreaterThanOrEqual(0.95);
    const jpeg = await runJob(page, 'images/sample.avif', base, [[3, 3]]);
    expect(jpeg.ok, jpeg.error).toBe(true);
    expect([jpeg.width, jpeg.height]).toEqual([80, 60]);
    expect(close(jpeg.samples?.[0], [255, 0, 0])).toBe(true);
  });

  test('real photo with the quality guard: crisp result (SSIM ≥ 0.97)', async ({ page }) => {
    const r = await runJob(page, 'quality/photo-product-on-white.jpg', {
      ...base,
      qualityGuard: true,
      resize: { mode: 'longest', value: 800 },
    });
    expect(r.ok, r.error).toBe(true);
    expect([r.width, r.height]).toEqual([800, 556]);
    expect(r.ssim).toBeGreaterThanOrEqual(0.97);
  });

  test('iPhone HEIC → JPEG', async ({ page }) => {
    test.setTimeout(180_000);
    const r = await runJob(page, 'images/iphone-7.heic', {
      ...base,
      resize: { mode: 'longest', value: 1000 },
    });
    expect(r.ok, r.error).toBe(true);
    expect([r.width, r.height, r.format]).toEqual([1000, 750, 'jpeg']);
    expect(r.ssim).toBeGreaterThanOrEqual(0.95);
  });

  test('a broken file gives a readable error', async ({ page }) => {
    const broken = await page.evaluate(async () => {
      const worker = new Worker('./image-worker.js', { type: 'module' });
      const reply = await new Promise<{ name?: string; value: { value?: { message?: string } } }>(
        (resolve) => {
          worker.onmessage = (
            e: MessageEvent<{ name?: string; value: { value?: { message?: string } } }>,
          ) => resolve(e.data);
          worker.postMessage({
            id: 'job',
            type: 'APPLY',
            path: ['run'],
            argumentList: [
              { type: 'RAW', value: 'process' },
              {
                type: 'RAW',
                value: {
                  file: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])]),
                  name: 'broken.png',
                  format: 'jpeg',
                  quality: 80,
                  metadata: 'strip-all',
                },
              },
              { type: 'RAW', value: undefined },
            ],
          });
        },
      );
      worker.terminate();
      return { name: reply.name, message: reply.value.value?.message };
    });
    expect(broken).toEqual({
      name: 'throw',
      message: "This file isn't an image Snap Convert can read",
    });
  });
});
