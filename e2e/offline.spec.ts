// Installable app and offline (P21): manifest + service worker make the app installable, the app
// shell is precached, engines are cached only once used, and a used tool works offline.
// Chromium only: installability is a Chromium check (as Lighthouse's), and Playwright's WebKit
// (Windows build) can't run the image worker anyway (see compress-image.spec.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE = readFileSync(path.resolve('public/samples/compress-sample.jpg'));

/** Every phase 1 page the service worker must have for offline use. */
const PAGES = [
  'compress-image',
  'resize-image',
  'convert-image',
  'optimize-for-web',
  'bulk-resize',
  'heic-to-jpg',
  'images-to-pdf',
  'merge-pdf',
  'split-pdf',
  'organize-pdf',
  'resize-pdf',
  'png-to-jpg',
  'credits',
  'privacy',
];

/** File names of things that must only be cached after use: codecs, pdf.js, pdf-lib, libheif… */
const ENGINE_FILE =
  /\.(?:wasm|bcmap|pfb|ttf)$|pdf\.worker|pdfjs-|libheif|pipeline-|encode-|decode-/;

interface EngineGraph {
  files: Record<string, { bytes: number; refs: string[] }>;
}

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Service worker and installability checks run in Chromium');
  testInfo.setTimeout(90_000);
});

/** Waits until the service worker is installed, active and controlling this page. */
async function serviceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
    }
  });
}

/** URLs in Cache Storage, by cache name. */
async function cached(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((r) => r.url);
    }
    return out;
  });
}

async function openCompress(page: Page): Promise<void> {
  await page.goto('compress-image');
  await expect(page.getByTestId('compress-drop')).toHaveAttribute('data-live', 'true');
}

async function compressSample(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop images here/ }).click();
  await (await chooser).setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: SAMPLE });
  await expect(page.locator('[data-testid="compare"][data-fresh]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('new-size')).toHaveText(/\d+(\.\d+)?\s*(B|KB|MB)/);
}

test('the app is installable: manifest, icons, theme colour and service worker', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('head link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/snap-convert/manifest.webmanifest',
  );
  await expect(page.locator('head meta[name="theme-color"]')).toHaveAttribute('content', '#c2410c');
  await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/snap-convert/icons/apple-touch-icon.png',
  );
  await serviceWorkerReady(page);

  // The same checks Chrome (and Lighthouse) use to offer installation.
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: Array<{ errorId: string }>;
  };
  expect(installabilityErrors).toEqual([]);
  const appManifest = (await cdp.send('Page.getAppManifest')) as {
    errors: unknown[];
    data?: string;
  };
  expect(appManifest.errors).toEqual([]);
  const manifest = JSON.parse(appManifest.data ?? '{}') as Record<string, unknown>;
  expect(manifest).toMatchObject({
    name: 'Snap Convert',
    short_name: 'Snap Convert',
    start_url: '/snap-convert/',
    scope: '/snap-convert/',
    display: 'standalone',
    theme_color: '#c2410c',
    background_color: '#fafaf9',
    categories: ['utilities', 'photo'],
  });
  const icons = manifest.icons as Array<{ src: string; sizes: string; purpose: string }>;
  expect(icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  for (const src of [...icons.map((i) => i.src), 'icons/apple-touch-icon.png']) {
    const res = await page.request.get(src);
    expect(res.status(), src).toBe(200);
    expect(res.headers()['content-type'], src).toBe('image/png');
  }
});

test('only the app shell is precached; engines are not downloaded until used', async ({ page }) => {
  await page.goto('./');
  await serviceWorkerReady(page);
  const caches = await cached(page);
  const all = Object.values(caches).flat();
  const paths = all.map((u) => new URL(u).pathname);

  // Every page is there, under the URL the site links to.
  for (const p of PAGES) expect(paths, p).toContain(`/snap-convert/${p}`);
  expect(paths).toContain('/snap-convert/index.html');
  expect(paths).toContain('/snap-convert/__spa-fallback.html');
  expect(paths).toContain('/snap-convert/manifest.webmanifest');
  expect(paths).toContain('/snap-convert/icons/icon-512.png');
  expect(paths.some((p) => p.endsWith('.woff2'))).toBe(true);

  // No engine file, by name or by the build's own engine list.
  expect(paths.filter((p) => ENGINE_FILE.test(p))).toEqual([]);
  const graph = (await (await page.request.get('pwa-engines.json')).json()) as EngineGraph;
  const engineFiles = Object.keys(graph.files);
  expect(engineFiles.length).toBeGreaterThan(50);
  expect(paths.filter((p) => engineFiles.includes(p.replace('/snap-convert/assets/', '')))).toEqual(
    [],
  );
  expect(caches['snap-convert-engines-v1'] ?? []).toEqual([]);
});

test('after one use, Compress works offline', async ({ page, context }) => {
  await openCompress(page);
  await serviceWorkerReady(page);
  await compressSample(page);

  // The image engine is now cached; other engines are still not downloaded.
  await expect
    .poll(async () => (await cached(page))['snap-convert-engines-v1'] ?? [])
    .toContainEqual(expect.stringMatching(/\/worker-[\w-]+\.js$/));
  const engines = (await cached(page))['snap-convert-engines-v1'] ?? [];
  expect(engines.filter((u) => /pdf\.worker|pdfjs-|libheif|\.bcmap$/.test(u))).toEqual([]);

  await context.setOffline(true);
  await openCompress(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await compressSample(page);
  await expect(page.getByText(/couldn't start|connection/i)).toHaveCount(0);

  // The rest of the site still opens offline.
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Convert, resize and compress files, right in your browser.',
  );
  await page.goto('./this-page-does-not-exist');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await context.setOffline(false);
});

test('a new version offers "Refresh", and Refresh switches to it', async ({ page }) => {
  await openCompress(page);
  await serviceWorkerReady(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(
    /\/snap-convert\/sw\.js$/,
  );

  // Stand-in for a new deploy, without touching the shared build: a service worker under a new
  // script URL installs next to the running one and waits, exactly like a changed sw.js.
  await page.evaluate(() =>
    navigator.serviceWorker.register('/snap-convert/sw.js?next', { scope: '/snap-convert/' }),
  );
  const toast = page.getByText('New version available');
  await expect(toast).toBeVisible({ timeout: 30_000 });

  // Refresh: the waiting version takes over and the page reloads under it.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Refresh to use the new version' }).click();
  await reloaded;
  await expect(page.getByTestId('compress-drop')).toHaveAttribute('data-live', 'true');
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(
    /\/snap-convert\/sw\.js\?next$/,
  );
});

test('offline, a tool never used here says to connect once', async ({ page, context }) => {
  await page.goto('./');
  await serviceWorkerReady(page);

  await context.setOffline(true);
  await page.goto('merge-pdf');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Merge PDF');
  const notice = page.getByText(
    /^Connect once to download this tool \(up to \d+\.\d MB\), then it works offline$/,
  );
  await expect(notice).toBeVisible();

  // Back online: the notice goes away.
  await context.setOffline(false);
  await expect(notice).toHaveCount(0);
});
