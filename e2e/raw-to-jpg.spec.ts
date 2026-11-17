// RAW to JPG (P30): camera RAW files through the page and the real image workers. The sample RAW
// (public/samples/raw-sample.cr3) runs everywhere; the CC0 camera files (`pnpm fixtures:raw`,
// tests/fixtures/raw/SOURCES.md) run in the @heavy tests, after the rest of the suite.
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { expect, test, type Page } from './support/test';

const CACHE = path.resolve('tests/fixtures/raw/cache');
const raw = (name: string) => path.join(CACHE, name);
const MISSING =
  'RAW test files missing: run `pnpm fixtures:raw` (downloads CC0 files from raw.pixls.us into tests/fixtures/raw/cache/)';
const have = (...names: string[]) => names.every((n) => existsSync(raw(n)));

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

/** One file per format (10 brands' formats), with two portrait files to check orientation. */
const TEN = [
  { file: 'canon-1100d.cr2', size: [4272, 2848] },
  { file: 'canon-m50.cr3', size: [6000, 4000] },
  { file: 'nikon-d500.nef', size: [5568, 3712] },
  { file: 'sony-a6400.arw', size: [6000, 4000] },
  { file: 'ricoh-gr-portrait.dng', size: [3264, 4928] }, // EXIF 6, developed
  { file: 'fuji-xs10.raf', size: [6240, 4160] },
  { file: 'olympus-ep5.orf', size: [4608, 3456] },
  { file: 'panasonic-g81.rw2', size: [4592, 3448] },
  { file: 'pentax-k5iis-portrait.pef', size: [3264, 4928] }, // EXIF 8, camera JPEG
  { file: 'samsung-nx500.srw', size: [6480, 4320] },
] as const;

const rows = (page: Page) =>
  page.getByRole('list', { name: 'RAW photos', exact: true }).getByRole('listitem');
const summary = (page: Page) => page.getByTestId('raw-summary');
const runButton = (page: Page) =>
  page.getByRole('button', { name: /^Convert \d+ photos? to / }).filter({ visible: true });

/** Width and height from a JPEG's SOF segment. */
function jpegSize(bytes: Uint8Array): [number, number] {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Not a JPEG marker');
    const marker = bytes[i + 1]!;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return [width, height];
    }
    i += 2 + length;
  }
  throw new Error('No SOF segment');
}

async function addFiles(page: Page, files: string[] | Parameters<Page['setInputFiles']>[1]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop RAW photos here/ }).click();
  await (await chooser).setFiles(files);
}

async function trySample(page: Page) {
  await page.getByRole('button', { name: 'Try a sample RAW' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Canon EOS R5', { timeout: 30_000 });
}

async function download(page: Page, name: RegExp): Promise<{ name: string; bytes: Uint8Array }> {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name }).filter({ visible: true }).first().click();
  const file = await event;
  return { name: file.suggestedFilename(), bytes: new Uint8Array(readFileSync(await file.path())) };
}

async function seriousViolations(page: Page): Promise<string[]> {
  // Not over a button: the scan is of the page at rest, not a hover state.
  await page.mouse.move(0, 0);
  const scan = await new AxeBuilder({ page }).include('main').analyze();
  return scan.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/**
 * How much brighter image `b` is than `a` (same size), in linear light: over the whole image,
 * and over the shadows and mid-tones of `a` (linear luminance 0.01–0.15), below the highlight
 * shoulder where one stop should double the light.
 */
function brightnessRatios(
  page: Page,
  a: Uint8Array,
  b: Uint8Array,
): Promise<{ all: number; midtones: number }> {
  return page.evaluate(
    async ([da, db]) => {
      const luminance = async (data: number[]) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(data)], { type: 'image/jpeg' }),
        );
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const lin = (v: number) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const out = new Float32Array(px.length / 4);
        for (let i = 0; i < out.length; i++) {
          out[i] =
            0.2126 * lin(px[i * 4]!) + 0.7152 * lin(px[i * 4 + 1]!) + 0.0722 * lin(px[i * 4 + 2]!);
        }
        return out;
      };
      const la = await luminance(da);
      const lb = await luminance(db);
      let sa = 0,
        sb = 0,
        ma = 0,
        mb = 0;
      for (let i = 0; i < la.length; i++) {
        sa += la[i]!;
        sb += lb[i]!;
        if (la[i]! >= 0.01 && la[i]! <= 0.15) {
          ma += la[i]!;
          mb += lb[i]!;
        }
      }
      return { all: sb / sa, midtones: mb / ma };
    },
    [Array.from(a), Array.from(b)] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('raw-to-jpg');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RAW to JPG');
});

test('the sample RAW: camera, megapixels and thumbnail, then a fast run to <name>.jpg', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  await trySample(page);
  const row = rows(page).first();
  await expect(row).toContainText('17 MP');
  await expect(row).toContainText('5088×3392');
  await expect(row).toContainText('camera JPG');
  // Thumbnail from the camera's JPEG, with the photo's shape.
  const thumb = row.locator('img');
  await expect(thumb).toBeVisible();
  const natural = await thumb.evaluate((img: HTMLImageElement) => [
    img.naturalWidth,
    img.naturalHeight,
  ]);
  expect(natural).toEqual([120, 80]);

  // Fast is the default; the develop controls only show in Full quality.
  await expect(page.getByRole('radio', { name: /^Fast/ })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Exposure' })).toHaveCount(0);
  await page.getByRole('radio', { name: /^Full quality/ }).click();
  await expect(page.getByRole('slider', { name: 'Exposure' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'White balance' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Highlights' })).toBeVisible();
  await page.getByRole('radio', { name: /^Fast/ }).click();

  if (isMobile) {
    // Phone layout: settings under the list, the action in the bar fixed to the bottom.
    const bar = page.getByRole('group', { name: 'Actions' });
    await expect(bar).toHaveCSS('position', 'fixed');
    await expect(bar.getByRole('button', { name: 'Convert 1 photo to JPG' })).toBeVisible();
    const list = await page.getByRole('list', { name: 'RAW photos', exact: true }).boundingBox();
    const panel = await page.getByRole('complementary', { name: 'Settings' }).boundingBox();
    expect(panel!.y).toBeGreaterThan(list!.y);
  }
  expect(await seriousViolations(page)).toEqual([]);

  await runButton(page).click();
  await expect(summary(page)).toContainText('1 done', { timeout: 90_000 });
  await expect(row).toContainText('sample-canon-r5.jpg');
  await expect(row).toContainText('Used your camera’s JPG');
  await expect(row.getByTestId('row-bytes')).toContainText(
    /6\.7 MB → New file size: [\d.]+ (KB|MB)/,
  );
  await expect(page.locator('[data-status="failed"]')).toHaveCount(0);

  const file = await download(page, /^Download$/);
  expect(file.name).toBe('sample-canon-r5.jpg');
  expect([...file.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  expect(jpegSize(file.bytes)).toEqual([5088, 3392]);
  expect(await seriousViolations(page)).toEqual([]);
});

test('both themes pass axe', async ({ page }) => {
  await trySample(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((s) => document.documentElement.setAttribute('data-theme', s), scheme);
    expect(await seriousViolations(page), scheme).toEqual([]);
  }
});

test('a damaged RAW says so on its own row and is left out of the run', async ({ page }) => {
  test.skip(!have('nikon-d500.nef'), MISSING);
  const cut = readFileSync(raw('nikon-d500.nef')).subarray(0, 96 * 1024);
  await addFiles(page, [{ name: 'broken.nef', mimeType: '', buffer: cut }]);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().getByTestId('row-error')).toHaveText(
    /looks damaged|isn't supported/,
    { timeout: 30_000 },
  );
  await expect(page.getByRole('button', { name: /^Convert 0 photos/ }).first()).toBeDisabled();
});

test.describe('offline', () => {
  test('after one use, the page works offline (RAW engine and sample cached)', async ({
    page,
    context,
    browserName,
    isMobile,
  }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'Service worker checks run in Chromium');
    test.setTimeout(180_000);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
        );
      }
    });
    const runOnce = async () => {
      await trySample(page);
      await runButton(page).click();
      await expect(summary(page)).toContainText('1 done', { timeout: 90_000 });
    };
    await runOnce();
    const cachedEngines = () =>
      page.evaluate(async () => {
        const cache = await caches.open('snap-convert-engines-v1');
        return (await cache.keys()).map((r) => r.url);
      });
    for (const file of [/\.wasm$/, /\/worker-[\w-]+\.js$/, /\/samples\/raw-sample\.cr3$/]) {
      await expect.poll(cachedEngines).toContainEqual(expect.stringMatching(file));
    }

    await context.setOffline(true);
    await page.goto('raw-to-jpg');
    await expect(page.getByText(/Connect once to download this tool/)).toHaveCount(0);
    await runOnce();
    await expect(rows(page).first()).toContainText('sample-canon-r5.jpg');
    await context.setOffline(false);
  });
});

test.describe('camera RAW files', { tag: '@heavy' }, () => {
  test.skip(!have(...TEN.map((f) => f.file), 'sony-a7r4-61mp.arw'), MISSING);

  test('10 formats → 10 JPGs in one run, upright, named <name>.jpg', async ({ page }) => {
    test.setTimeout(900_000);
    await addFiles(
      page,
      TEN.map((f) => raw(f.file)),
    );
    await expect(rows(page)).toHaveCount(10);
    await expect(runButton(page)).toHaveText('Convert 10 photos to JPG');
    await runButton(page).click();
    await expect(summary(page)).toContainText(/Processing \d at a time/);
    await expect(summary(page)).toContainText('10 done', { timeout: 840_000 });
    await expect(page.locator('[data-status="failed"]')).toHaveCount(0);
    // Upright before and after: the portrait files list as portrait.
    await expect(rows(page).filter({ hasText: 'pentax-k5iis-portrait' })).toContainText(
      '3264×4928 → 3264×4928',
    );

    const event = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download ZIP' })
      .filter({ visible: true })
      .first()
      .click();
    const zip = unzipSync(new Uint8Array(readFileSync(await (await event).path())));
    expect(Object.keys(zip).sort()).toEqual(
      TEN.map((f) => f.file.replace(/\.[^.]+$/, '.jpg')).sort(),
    );
    for (const f of TEN) {
      const bytes = zip[f.file.replace(/\.[^.]+$/, '.jpg')]!;
      expect(jpegSize(bytes), f.file).toEqual(f.size);
    }
  });

  test('Exposure +1 brightens by about one stop', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop: two full develops');
    test.setTimeout(300_000);
    await addFiles(page, [raw('canon-m50.cr3')]);
    await expect(rows(page).first()).toContainText('Canon EOS M50', { timeout: 30_000 });
    await page.getByRole('radio', { name: /^Full quality/ }).click();
    // Smaller outputs keep the test quick (half-size develop, then resized).
    await page.getByRole('checkbox', { name: /Also resize/ }).click();

    const brightness = async (stops: number) => {
      const slider = page.getByRole('slider', { name: 'Exposure' });
      await slider.focus();
      await page.keyboard.press('Home');
      for (let i = 0; i < (stops + 2) / 0.5; i++) await page.keyboard.press('ArrowRight');
      await expect(slider).toHaveAttribute('aria-valuenow', String(stops));
      await runButton(page).click();
      await expect(summary(page)).toContainText('1 done', { timeout: 240_000 });
      const file = await download(page, /^Download$/);
      return file.bytes;
    };
    const base = await brightness(0);
    const plusOne = await brightness(1);
    const ratio = await brightnessRatios(page, base, plusOne);
    test.info().annotations.push({
      type: 'exposure',
      description: `+1 EV vs 0 EV, linear light: ×${ratio.all.toFixed(2)} overall, ×${ratio.midtones.toFixed(2)} in shadows and mid-tones`,
    });
    // One stop doubles the light below the highlight shoulder; brights are held back by it.
    expect(ratio.midtones).toBeGreaterThan(1.6);
    expect(ratio.midtones).toBeLessThan(2.5);
    expect(ratio.all).toBeGreaterThan(1.3);
  });

  test.describe('on an iPhone', () => {
    test.use({ userAgent: IPHONE_UA });

    test('61 MP ARW: the page warns first, then develops at half size and says so', async ({
      page,
    }, testInfo) => {
      test.skip(!testInfo.project.name.includes('phone'), 'Phone layout');
      test.setTimeout(600_000);
      await addFiles(page, [raw('sony-a7r4-61mp.arw')]);
      await expect(rows(page).first()).toContainText('Sony ILCE-7RM4', { timeout: 60_000 });
      await expect(rows(page).first()).toContainText('9504×6336');
      await expect(page.getByTestId('phone-advice')).toContainText(
        /Large RAW file — this phone can’t develop it at full size/,
      );
      await runButton(page).click();
      await expect(summary(page)).toContainText('1 done', { timeout: 540_000 });
      await expect(rows(page).first()).toContainText('9504×6336 → 4752×3168');
      await expect(rows(page).first().getByTestId('row-notes')).toContainText(
        'Decoded at half size to fit this phone’s memory — use a computer for full size',
      );
      expect(await page.evaluate(() => 1 + 1)).toBe(2);
    });
  });
});
