// P29: camera RAW files through the real image worker in every Playwright browser — above all
// WebKit (Safari's engine), with the RAW worker nested inside the image worker, FlashRaw's
// WebAssembly, and the half-size path an iPhone takes for big files.
//
// No page runs RAW jobs until P30, so, like image-engine-webkit.spec.ts, this spec bundles
// src/engines/image/worker.ts with Vite (production mode) into a temporary folder and serves it
// (and the RAW test files) from its own local server with the app's cross-origin isolation
// headers. Needs `pnpm fixtures:raw`; skipped with a message without it.
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, test, type Page } from './support/test';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = path.join(root, 'tests/fixtures/raw/cache');
const FILES = ['canon-m50.cr3', 'sony-a6400.arw', 'sony-a7r4-61mp.arw', 'nikon-zf.nef'];
const missing = FILES.filter((f) => !existsSync(path.join(cache, f)));
const MISSING =
  'RAW test files missing: run `pnpm fixtures:raw` (downloads CC0 files from raw.pixls.us into tests/fixtures/raw/cache/)';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

interface Harness {
  url: string;
  close: () => Promise<void>;
}

/** Bundles the image worker (with the RAW engine and its worker) and serves it with the RAW files. */
async function startHarness(): Promise<Harness> {
  const outDir = await mkdtemp(path.join(tmpdir(), 'snap-convert-raw-engine-'));
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
  await writeFile(path.join(outDir, 'index.html'), '<!doctype html><title>RAW engine</title>');
  const server: Server = createServer((req, res) => {
    void (async () => {
      const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(
        /^\/+/,
        '',
      );
      const fixture = rel.startsWith('fixtures/') ? path.basename(rel) : undefined;
      const file = fixture ? path.join(cache, fixture) : path.resolve(outDir, rel || 'index.html');
      if (!fixture && !file.startsWith(outDir)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'same-origin',
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

interface JobOutcome {
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  format?: string;
  ssim?: number;
  notes?: string[];
  ms?: number;
  isolated?: boolean;
}

/** Runs one job in a fresh image worker on the page (Comlink's APPLY message), RAW file by name. */
function runJob(page: Page, fixture: string, input: Record<string, unknown>): Promise<JobOutcome> {
  return page.evaluate(
    async ({ fixture, input }) => {
      const blob = await (await fetch(`./fixtures/${fixture}`)).blob();
      const file = new File([blob], fixture);
      const worker = new Worker('./image-worker.js', { type: 'module' });
      const start = performance.now();
      try {
        const reply = await new Promise<{ type: string; name?: string; value: unknown }>(
          (resolve, reject) => {
            worker.onmessage = (e: MessageEvent<{ type: string; name?: string; value: unknown }>) =>
              resolve(e.data);
            worker.onerror = (e) => reject(new Error(e.message));
            worker.postMessage({
              id: 'job',
              type: 'APPLY',
              path: ['run'],
              argumentList: [
                { type: 'RAW', value: 'process' },
                { type: 'RAW', value: { ...input, file, name: fixture } },
                { type: 'RAW', value: undefined },
              ],
            });
          },
        );
        const ms = performance.now() - start;
        if (reply.type === 'HANDLER' && reply.name === 'throw') {
          const thrown = reply.value as { value?: { message?: string } };
          return { ok: false, error: thrown.value?.message ?? 'error' };
        }
        const r = reply.value as {
          width: number;
          height: number;
          format: string;
          ssim: number;
          notes: string[];
        };
        return {
          ok: true,
          width: r.width,
          height: r.height,
          format: r.format,
          ssim: r.ssim,
          notes: r.notes,
          ms,
          isolated: crossOriginIsolated,
        };
      } finally {
        worker.terminate();
      }
    },
    { fixture, input },
  );
}

const jpeg = { format: 'jpeg', quality: 80, metadata: 'strip-location' };

let harness: Harness | undefined;
test.use({ allowRequests: [/^http:\/\/127\.0\.0\.1:\d+\//] });

test.describe('camera RAW in this browser', () => {
  test.skip(missing.length > 0, MISSING);

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    harness = await startHarness();
  });
  test.afterAll(async () => {
    await harness?.close();
  });
  test.beforeEach(async ({ page }) => {
    await page.goto(harness!.url);
  });

  test('CR3, fast: the camera JPEG, re-encoded', async ({ page, browserName }) => {
    test.setTimeout(180_000);
    const r = await runJob(page, 'canon-m50.cr3', { ...jpeg, qualityGuard: true });
    expect(r.ok, r.error).toBe(true);
    expect([r.width, r.height, r.format]).toEqual([6000, 4000, 'jpeg']);
    expect(r.notes).toContain('raw-preview');
    expect(r.ssim).toBeGreaterThanOrEqual(0.95);
    test.info().annotations.push({
      type: 'RAW fast',
      description: `${browserName}: ${r.ms?.toFixed(0)} ms, cross-origin isolated: ${r.isolated}`,
    });
  });

  test('ARW, full develop resized for the web', async ({ page, browserName }) => {
    test.setTimeout(240_000);
    const r = await runJob(page, 'sony-a6400.arw', {
      ...jpeg,
      raw: { mode: 'full', whiteBalance: 'as-shot', exposure: 0, highlights: 'clip' },
      resize: { mode: 'longest', value: 2400 },
    });
    expect(r.ok, r.error).toBe(true);
    expect([r.width, r.height]).toEqual([2400, 1600]);
    expect(r.notes).not.toContain('raw-preview');
    expect(r.ssim).toBeGreaterThanOrEqual(0.95);
    test.info().annotations.push({
      type: 'RAW full',
      description: `${browserName}: ${r.ms?.toFixed(0)} ms`,
    });
  });

  test('high-efficiency NEF (FlashRaw only), full develop', async ({ page }) => {
    test.setTimeout(240_000);
    const r = await runJob(page, 'nikon-zf.nef', {
      ...jpeg,
      raw: { mode: 'full', whiteBalance: 'auto', exposure: 0.5, highlights: 'recover' },
      resize: { mode: 'longest', value: 1600 },
    });
    expect(r.ok, r.error).toBe(true);
    expect([r.width, r.height]).toEqual([1600, 1067]);
  });

  test.describe('on an iPhone', () => {
    test.use({ userAgent: IPHONE_UA });

    test('61 MP ARW: developed at half size, the note is there, the tab survives', async ({
      page,
      browserName,
    }) => {
      test.setTimeout(300_000);
      const r = await runJob(page, 'sony-a7r4-61mp.arw', { ...jpeg, qualityGuard: true });
      expect(r.ok, r.error).toBe(true);
      expect([r.width, r.height]).toEqual([4752, 3168]);
      expect(r.notes).toContain('raw-half-size');
      // The page is still alive and responsive.
      expect(await page.evaluate(() => 1 + 1)).toBe(2);
      test.info().annotations.push({
        type: 'RAW 61 MP on iPhone',
        description: `${browserName}: ${r.ms?.toFixed(0)} ms`,
      });
    });
  });
});
