// P24 real-world run: every phase 1 tool against large, realistic files (48 MP photo, iPhone HEIC
// with GPS, real phone JPEG, retina screenshot with text, transparent logo, 300-page PDF, scanned
// PDF, password-protected PDF). Opt-in, because it is slow and generates ~60 MB of inputs:
//   E2E_REAL=1 E2E_PORT=<port> pnpm e2e real-world --project chromium-desktop --project chromium-phone
// Outputs land in test-results/real-world/ for side-by-side inspection; timings are attached to
// each test as annotations. Files in tests/fixtures/real/owner/ are run through Compress as well.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import {
  fixture,
  logoPng,
  ownerFiles,
  pdf300,
  photo48mp,
  scannedPdf,
  screenshotPng,
  type Upload,
} from './support/real-fixtures';
import { expect, test, type Download, type Page } from './support/test';

test.skip(!process.env.E2E_REAL, 'real-world run is opt-in: set E2E_REAL=1');
test.skip(({ browserName }) => browserName !== 'chromium', 'inputs are generated with Chromium');
test.describe.configure({ timeout: 600_000 });

const OUT = path.resolve('test-results/real-world');
const phone = () => test.info().project.name.includes('phone');

async function save(download: Download, name = download.suggestedFilename()): Promise<Buffer> {
  const bytes = readFileSync(await download.path());
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${phone() ? 'phone-' : ''}${name}`), bytes);
  return bytes;
}

function timing(label: string, started: number) {
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  test.info().annotations.push({ type: 'time', description: `${label}: ${seconds} s` });
}

/** Opens a tool's picker (retried until the page has hydrated) and chooses the files. */
async function addFiles(page: Page, zone: RegExp, files: Upload[]) {
  const button = page.getByRole('button', { name: zone });
  await expect(async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 5_000 });
    await button.click();
    await (await chooser).setFiles(files);
  }).toPass({ timeout: 40_000 });
}

async function downloadBy(page: Page, name: string | RegExp): Promise<Download> {
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name, exact: typeof name === 'string' })
    .filter({ visible: true })
    .first()
    .click();
  return pending;
}

/** Size of an image decoded by the browser (orientation applied). */
async function decodedSize(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data]), { imageOrientation: 'from-image' });
    return `${bitmap.width}×${bitmap.height}`;
  }, bytes.toString('base64'));
}

test('Compress: 48 MP photo at defaults', async ({ page }) => {
  const photo = await photo48mp(page);
  await page.goto('compress-image');
  const started = Date.now();
  await addFiles(page, /^Drop images here/, [photo]);
  await expect(page.locator('[data-testid="compare"][data-fresh]')).toBeVisible({
    timeout: 300_000,
  });
  timing('48 MP compress', started);
  const bytes = await save(await downloadBy(page, 'Download'), 'compress-48mp.jpg');
  expect(await decodedSize(page, bytes)).toBe('8000×6000');
  expect(bytes.length).toBeLessThan(photo.buffer.length);
});

test('Resize and Optimize for web: 48 MP photo', async ({ page }) => {
  const photo = await photo48mp(page);
  await page.goto('optimize-for-web');
  let started = Date.now();
  await addFiles(page, /^Drop images for your website/, [photo]);
  await expect(page.getByTestId('file-row').getByTestId('file-dims')).toHaveText(
    '8000×6000 → 1920×1440',
  );
  const optimized = await save(await downloadBy(page, /^Download/), 'optimize-48mp.jpg');
  timing('48 MP optimize for web', started);
  expect(await decodedSize(page, optimized)).toBe('1920×1440');

  await page.goto('resize-image');
  started = Date.now();
  await addFiles(page, /^Drop images here/, [photo]);
  const field = page.getByRole('spinbutton', { name: 'Size', exact: true });
  await field.fill('3000');
  await field.press('Enter');
  await expect(page.getByTestId('result-stat')).toContainText('3000×2250', { timeout: 300_000 });
  timing('48 MP resize to 3000', started);
  const resized = await save(await downloadBy(page, 'Download'), 'resize-48mp-3000.jpg');
  expect(await decodedSize(page, resized)).toBe('3000×2250');
});

test('HEIC to JPG: iPhone photo with GPS', async ({ page }) => {
  await page.goto('heic-to-jpg');
  const started = Date.now();
  await addFiles(page, /^Drop HEIC photos here/, [fixture('images/iphone-7.heic')]);
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled({
    timeout: 300_000,
  });
  timing('HEIC to JPG', started);
  const bytes = await save(await downloadBy(page, 'Download'), 'heic-iphone.jpg');
  expect(await decodedSize(page, bytes)).toBe('4032×3024');
});

test('Convert: transparent logo → JPG on white and → WebP with alpha', async ({
  page,
  browser,
}) => {
  const logo = await logoPng(browser);
  await page.goto('convert-image');
  await addFiles(page, /^Drop images here/, [logo]);
  const saveAs = page.getByRole('combobox', { name: 'Save as' });
  for (const format of ['JPG', 'WebP']) {
    await saveAs.click();
    await page.getByRole('option', { name: format, exact: true }).click();
    const download = await downloadBy(page, /^Download (all|ZIP)|^Download$/);
    const bytes = await save(
      download,
      `convert-${format.toLowerCase()}.${download.suggestedFilename().split('.').pop()}`,
    );
    expect(bytes.length).toBeGreaterThan(0);
  }
});

test('Compress: retina screenshot with text is treated as a graphic', async ({
  page,
  browser,
  baseURL,
}) => {
  const shot = await screenshotPng(browser, baseURL!);
  await page.goto('compress-image');
  await addFiles(page, /^Drop images here/, [shot]);
  await expect(page.locator('[data-testid="compare"][data-fresh]')).toBeVisible({
    timeout: 120_000,
  });
  const download = await downloadBy(page, 'Download');
  await save(download, `compress-${download.suggestedFilename()}`);
  // Graphics stay lossless (PNG) by default, so text is never smeared.
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test('Compress: the reference photos at defaults (outputs kept for side-by-side checks)', async ({
  page,
}) => {
  for (const name of [
    'photo-fine-detail.jpg',
    'photo-night-noise.jpg',
    'photo-product-on-white.jpg',
    'photo-portrait-exif-rotated.jpg',
    'sky-gradient.png',
    'text-screenshot.png',
    'line-art-logo.png',
  ]) {
    await page.goto('compress-image');
    await addFiles(page, /^Drop images here/, [fixture(`quality/${name}`)]);
    await expect(page.locator('[data-testid="compare"][data-fresh]')).toBeVisible({
      timeout: 120_000,
    });
    const download = await downloadBy(page, 'Download');
    await save(download, `compress-ref-${download.suggestedFilename()}`);
  }
});

test('Bulk: mixed real files → ZIP', async ({ page, browser, baseURL }) => {
  const files = [
    await photo48mp(page),
    fixture('images/iphone-7.heic'),
    fixture('quality/photo-portrait-exif-rotated.jpg'),
    await screenshotPng(browser, baseURL!),
    await logoPng(browser),
    ...ownerFiles().filter((f) => /\.(jpe?g|png|webp|avif|heic|heif|gif|bmp)$/i.test(f.name)),
  ];
  await page.goto('bulk-resize');
  await addFiles(page, /^Drop as many images as you like/, files);
  const started = Date.now();
  await page.getByRole('button', { name: /^Resize \d+ images?$/ }).click();
  await expect(page.getByTestId('bulk-summary')).toContainText(`${files.length} done`, {
    timeout: 500_000,
  });
  timing(`Bulk ${files.length} files`, started);
  const zip = unzipSync(
    new Uint8Array(await save(await downloadBy(page, 'Download ZIP'), 'bulk.zip')),
  );
  expect(Object.keys(zip)).toHaveLength(files.length);
});

test('Images to PDF: HEIC, 48 MP, portrait, screenshot, logo', async ({
  page,
  browser,
  baseURL,
}) => {
  const files = [
    fixture('images/iphone-7.heic'),
    await photo48mp(page),
    fixture('quality/photo-portrait-exif-rotated.jpg'),
    await screenshotPng(browser, baseURL!),
    await logoPng(browser),
  ];
  await page.goto('images-to-pdf');
  await addFiles(page, /^Drop images here/, files);
  await expect(
    page.getByRole('list', { name: 'Pages, in order' }).getByRole('listitem'),
  ).toHaveCount(5);
  const started = Date.now();
  await page
    .getByRole('button', { name: /^Make PDF/ })
    .first()
    .click();
  await expect(page.getByTestId('pdf-result')).toBeVisible({ timeout: 300_000 });
  timing('Images to PDF (5 images)', started);
  const pdf = await PDFDocument.load(
    await save(await downloadBy(page, 'Download PDF'), 'images.pdf'),
  );
  expect(pdf.getPageCount()).toBe(5);
});

test('Merge: 300-page report + scanned PDF; password PDF is refused', async ({ page }) => {
  const big = await pdf300();
  const scan = await scannedPdf(page);
  await page.goto('merge-pdf');
  await addFiles(page, /^Drop PDF files here/, [big, scan, fixture('pdf/encrypted.pdf')]);
  await expect(page.getByText("Password-protected — can't be merged")).toBeVisible({
    timeout: 60_000,
  });
  const merge = page.getByRole('button', { name: 'Merge 2 PDFs' });
  await expect(merge).toBeEnabled({ timeout: 60_000 });
  const started = Date.now();
  await merge.click();
  const pdf = await PDFDocument.load(
    await save(await downloadBy(page, 'Download PDF'), 'merged.pdf'),
  );
  timing('Merge 300 + 12 pages', started);
  expect(pdf.getPageCount()).toBe(312);
});

test('Split: 300-page PDF, every page → ZIP of 300', async ({ page }) => {
  await page.goto('split-pdf');
  await addFiles(page, /^Drop a PDF here/, [await pdf300()]);
  await expect(page.getByTestId('split-page')).toHaveCount(300, { timeout: 60_000 });
  await page.getByRole('radio', { name: 'Every page' }).click();
  const started = Date.now();
  await page.getByRole('button', { name: 'Split into 300 PDFs' }).click();
  await expect(page.getByTestId('split-part')).toHaveCount(300, { timeout: 300_000 });
  const zip = unzipSync(
    new Uint8Array(await save(await downloadBy(page, 'Download all 300 as ZIP'), 'split.zip')),
  );
  timing('Split 300 pages', started);
  expect(Object.keys(zip)).toHaveLength(300);
});

test('Organize: 300-page PDF, delete the first page and save', async ({ page }) => {
  await page.goto('organize-pdf');
  await expect(page.getByTestId('organize-pdf')).toHaveAttribute('data-live', 'true');
  await addFiles(page, /^Drop a PDF here/, [await pdf300()]);
  await expect(page.getByRole('option')).toHaveCount(300, { timeout: 60_000 });
  await page.locator('[role="option"][data-page="1"]').click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('option')).toHaveCount(299);
  const started = Date.now();
  await page.getByRole('button', { name: 'Save PDF' }).click();
  await expect(page.getByTestId('organize-result')).toBeVisible({ timeout: 120_000 });
  const pdf = await PDFDocument.load(
    await save(await downloadBy(page, 'Download'), 'organized.pdf'),
  );
  timing('Organize save 299 pages', started);
  expect(pdf.getPageCount()).toBe(299);
});

test('Resize PDF: scanned pages A4 → Letter', async ({ page }) => {
  await page.goto('resize-pdf');
  await expect(page.getByTestId('resize-pdf')).toHaveAttribute('data-live', 'true');
  await addFiles(page, /^Drop PDF files here/, [await scannedPdf(page)]);
  await page.getByRole('combobox', { name: 'Page size' }).click();
  await page.getByRole('option', { name: /^Letter/ }).click();
  await page.getByRole('button', { name: 'Resize 1 PDF' }).click();
  await expect(page.getByTestId('resize-result')).toBeVisible({ timeout: 120_000 });
  const pdf = await PDFDocument.load(
    await save(await downloadBy(page, /^Download/), 'resized.pdf'),
  );
  expect(pdf.getPageCount()).toBe(12);
  expect(Math.round(pdf.getPage(0).getWidth())).toBe(612);
});

test('owner files: every image compresses at defaults', async ({ page }) => {
  const files = ownerFiles().filter((f) => /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(f.name));
  test.skip(files.length === 0, 'no owner files in tests/fixtures/real/owner/');
  for (const file of files) {
    await page.goto('compress-image');
    await addFiles(page, /^Drop images here/, [file]);
    await expect(page.locator('[data-testid="compare"][data-fresh]')).toBeVisible({
      timeout: 300_000,
    });
    await save(await downloadBy(page, 'Download'), `owner-${file.name}`);
  }
});
