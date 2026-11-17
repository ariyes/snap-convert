// PDF to images (P31): pages to JPG/PNG at a chosen DPI. Sizes are read from the downloaded files
// themselves (JPEG SOF / PNG IHDR), names from the ZIP.
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { unzipSync } from 'fflate';
import { expect, test, type Download, type Page } from './support/test';

const fixture = (name: string) => readFileSync(path.resolve('tests/fixtures', name));

async function downloaded(download: Download): Promise<Uint8Array> {
  return new Uint8Array(await readFile(await download.path()));
}

/** Width and height from a JPEG's start-of-frame or a PNG's header. */
function imageSize(bytes: Uint8Array): { type: 'jpeg' | 'png'; width: number; height: number } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { type: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG or PNG');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      return {
        type: 'jpeg',
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!,
      };
    }
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
  }
  throw new Error('no JPEG frame header');
}

async function pick(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop a PDF here/ }).click();
  await (await chooser).setFiles([{ name, mimeType: 'application/pdf', buffer }]);
}

const tiles = (page: Page) => page.getByTestId('pdf-page');
const results = (page: Page) => page.getByTestId('page-result');
const runButton = (page: Page) => page.getByRole('button', { name: /^Save (\d+ pages?|pages)/ });
const rangesField = (page: Page) => page.getByLabel('Pages to save');

async function setResolution(page: Page, name: 'Screen' | 'Standard' | 'Print' | 'Custom') {
  await page.getByRole('radio', { name, exact: true }).click();
  await expect(page.getByRole('radio', { name, exact: true })).toBeChecked();
}

/** Clicks "Download all N as ZIP" and returns the ZIP's files. */
async function zipEntries(page: Page, count: number): Promise<Record<string, Uint8Array>> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: `Download all ${count} as ZIP` }).click();
  return unzipSync(await downloaded(await downloading));
}

test.beforeEach(async ({ page }) => {
  await page.goto('pdf-to-images');
});

test('a 3-page A4 PDF at 150 dpi → a ZIP of 3 JPGs of exactly 1240 × 1754', async ({ page }) => {
  test.setTimeout(120_000);
  await pick(page, 'report.pdf', fixture('pdf/a4-3-pages.pdf'));
  await expect(tiles(page)).toHaveCount(3);
  await expect(page.getByTestId('page-size')).toHaveText('Page 1: 1240 × 1754 px');
  await expect(runButton(page)).toHaveText('Save 3 pages as JPG');

  await runButton(page).click();
  await expect(page.getByTestId('results-title')).toContainText('3 images ready', {
    timeout: 90_000,
  });
  await expect(results(page).locator('span[title]')).toHaveText([
    'report-p01.jpg',
    'report-p02.jpg',
    'report-p03.jpg',
  ]);
  await expect(results(page).first()).toContainText('1240 × 1754');

  const entries = await zipEntries(page, 3);
  expect(Object.keys(entries).sort()).toEqual([
    'report-p01.jpg',
    'report-p02.jpg',
    'report-p03.jpg',
  ]);
  for (const bytes of Object.values(entries)) {
    expect(imageSize(bytes)).toEqual({ type: 'jpeg', width: 1240, height: 1754 });
  }
});

test('rotated and landscape pages come out landscape; PNG keeps every page', async ({ page }) => {
  test.setTimeout(120_000);
  await pick(page, 'mixed.pdf', fixture('pdf-to-images/mixed-pages.pdf'));
  await expect(tiles(page)).toHaveCount(3);
  await page.getByRole('radio', { name: 'PNG', exact: true }).click();
  await setResolution(page, 'Screen');
  await expect(page.getByRole('radio', { name: 'Auto' })).toHaveCount(0); // JPG only
  await runButton(page).click();
  await expect(page.getByTestId('results-title')).toContainText('3 images ready', {
    timeout: 90_000,
  });
  const entries = await zipEntries(page, 3);
  expect(imageSize(entries['mixed-p01.png']!)).toEqual({ type: 'png', width: 595, height: 842 });
  expect(imageSize(entries['mixed-p02.png']!)).toEqual({ type: 'png', width: 842, height: 595 });
  expect(imageSize(entries['mixed-p03.png']!)).toEqual({ type: 'png', width: 792, height: 612 });
});

test('"1-3, 5" on a 10-page PDF → 4 images named by page; bad ranges disable Save', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await pick(page, 'ten.pdf', fixture('pdf/ten-pages.pdf'));
  await expect(tiles(page)).toHaveCount(10);
  await page.getByRole('radio', { name: 'Choose pages' }).click();
  const field = rangesField(page);

  const cases: Array<[string, string]> = [
    ['3-1', '“3-1” is backwards — write it as 1-3'],
    ['1-3, 12', "Page 12 doesn't exist — this PDF has 10 pages"],
    ['1-3, x', "“x” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['0', 'Page numbers start at 1'],
  ];
  for (const [input, message] of cases) {
    await field.fill(input);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(runButton(page)).toBeDisabled();
  }
  await field.fill('');
  await expect(page.getByText('Enter the pages you want, like 1-3, 5, 8-10')).toBeVisible();
  await expect(runButton(page)).toBeDisabled();

  // Clicking thumbnails picks pages too.
  await page.getByRole('button', { name: 'Page 7', exact: true }).click();
  await expect(field).toHaveValue('7');
  await expect(page.getByRole('button', { name: 'Page 7', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await field.fill('1-3, 5');
  await expect(tiles(page).and(page.locator('[data-picked]'))).toHaveCount(4);
  await setResolution(page, 'Screen');
  await expect(runButton(page)).toHaveText('Save 4 pages as JPG');
  await runButton(page).click();
  await expect(page.getByTestId('results-title')).toContainText('4 images ready', {
    timeout: 90_000,
  });
  const entries = await zipEntries(page, 4);
  expect(Object.keys(entries).sort()).toEqual([
    'ten-p01.jpg',
    'ten-p02.jpg',
    'ten-p03.jpg',
    'ten-p05.jpg',
  ]);
});

test('one page saves as one file with a plain Download button', async ({ page }) => {
  test.setTimeout(90_000);
  await pick(page, 'report.pdf', fixture('pdf/a4-3-pages.pdf'));
  await page.getByRole('radio', { name: 'Choose pages' }).click();
  await rangesField(page).fill('2');
  await setResolution(page, 'Custom');
  await page.getByLabel('Dots per inch').fill('100');
  await expect(page.getByTestId('page-size')).toHaveText('Page 2: 827 × 1169 px');
  await expect(page.getByTestId('name-example')).toHaveText('report-p02.jpg');
  await runButton(page).click();

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click({ timeout: 60_000 });
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('report-p02.jpg');
  expect(imageSize(await downloaded(download))).toEqual({
    type: 'jpeg',
    width: 827,
    height: 1169,
  });
});

test('300 dpi on an A0 poster is capped at 50 MP and says at which dpi', async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== 'chromium' || isMobile, 'A 50 MP page: once, on desktop Chromium');
  test.setTimeout(180_000);
  await pick(page, 'poster.pdf', fixture('pdf-to-images/a0-page.pdf'));
  await setResolution(page, 'Print');
  await expect(page.getByTestId('page-size')).toHaveText(
    'Page 1: 5927 × 8379 px — capped at 179 dpi, the most this page can use',
  );
  await runButton(page).click();
  await expect(page.getByTestId('reduced-note')).toHaveText(
    'Saved at 179 dpi — the largest this device can draw.',
    { timeout: 150_000 },
  );
  await expect(results(page).first()).toContainText('5927 × 8379');
});

test('a password-protected PDF says so and nothing runs', async ({ page }) => {
  await pick(page, 'locked.pdf', fixture('pdf/encrypted.pdf'));
  await expect(
    page.getByText("This PDF is password-protected — it can't be opened."),
  ).toBeVisible();
  await expect(runButton(page)).toBeDisabled();
  await expect(results(page)).toHaveCount(0);
});

test('Cancel stops drawing and encoding; Retry finishes the rest', async ({ page }) => {
  test.setTimeout(150_000);
  await pick(page, 'ten.pdf', fixture('pdf/ten-pages.pdf'));
  await expect(tiles(page)).toHaveCount(10);
  await setResolution(page, 'Print');
  await runButton(page).click();
  await expect(page.getByTestId('run-progress')).toContainText(/of 10 pages/);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByText('Stopped. Pages already saved are ready below.')).toBeVisible();
  const stopped = results(page).and(page.locator('[data-status="cancelled"]'));
  await expect(stopped.first()).toBeVisible();
  const left = await stopped.count();
  expect(left).toBeGreaterThan(0);
  // Nothing keeps running after Cancel.
  await expect(
    results(page).and(page.locator('[data-status="rendering"], [data-status="encoding"]')),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Retry the rest' }).click();
  await expect(page.getByTestId('results-title')).toContainText('10 images ready', {
    timeout: 120_000,
  });
});

test('leaving the page mid-run stops it without errors', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await pick(page, 'ten.pdf', fixture('pdf/ten-pages.pdf'));
  await setResolution(page, 'Print');
  await runButton(page).click();
  await expect(page.getByTestId('run-progress')).toBeVisible();
  await page.getByRole('link', { name: 'All tools' }).first().click();
  await expect(page).toHaveURL(/\/snap-convert\/$/);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('sample PDF and accessibility', async ({ page }) => {
  await page.getByRole('button', { name: 'Try with a sample PDF' }).click();
  await expect(tiles(page)).toHaveCount(10);
  await expect(tiles(page).first().locator('[data-state="ready"] canvas')).toBeVisible();
  await expect(runButton(page)).toHaveText('Save 10 pages as JPG');

  const scan = await new AxeBuilder({ page }).include('main').analyze();
  const serious = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});

test.describe('offline', () => {
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

  test('after one use, the page works offline (pdf.js and the image engine are cached)', async ({
    page,
    context,
    browserName,
    isMobile,
  }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'Service worker checks run in Chromium');
    test.setTimeout(120_000);
    await serviceWorkerReady(page);
    const runOnce = async () => {
      await pick(page, 'report.pdf', fixture('pdf/a4-3-pages.pdf'));
      await expect(tiles(page).first().locator('[data-state="ready"]')).toBeVisible();
      await setResolution(page, 'Screen');
      await runButton(page).click();
      await expect(page.getByTestId('results-title')).toContainText('3 images ready', {
        timeout: 60_000,
      });
    };
    await runOnce();

    // The service worker stores engine files as they arrive: pdf.js, its worker, the image worker.
    const cachedEngines = () =>
      page.evaluate(async () => {
        const cache = await caches.open('snap-convert-engines-v1');
        return (await cache.keys()).map((r) => r.url);
      });
    for (const file of [/\/pdfjs-[\w-]+\.js$/, /pdf\.worker/, /\/worker-[\w-]+\.js$/]) {
      await expect.poll(cachedEngines).toContainEqual(expect.stringMatching(file));
    }

    await context.setOffline(true);
    await page.goto('pdf-to-images');
    await expect(page.getByText(/Connect once to download this tool/)).toHaveCount(0);
    await runOnce();
    await context.setOffline(false);
  });
});
