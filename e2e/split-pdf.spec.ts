// Split PDF (P19): custom ranges (with live validation), every N pages, every page into a ZIP.
// Test PDFs give every page its own width, so pdf-lib can tell exactly which pages each part has.
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from './support/test';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';

/** A PDF whose page n is (200 + n) points wide, so a page's width tells its number. */
async function numberedPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= pages; n++) doc.addPage([200 + n, 300]);
  return Buffer.from(await doc.save());
}

async function pageNumbers(pdf: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((p) => Math.round(p.getWidth()) - 200);
}

async function downloaded(download: Download): Promise<Uint8Array> {
  return new Uint8Array(await readFile(await download.path()));
}

async function pick(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop a PDF here/ }).click();
  await (await chooser).setFiles([{ name, mimeType: 'application/pdf', buffer }]);
}

const tiles = (page: Page) => page.getByTestId('split-page');
const parts = (page: Page) => page.getByTestId('split-part');
const rangesField = (page: Page) => page.getByLabel('Pages for each part');
const splitButton = (page: Page) => page.getByRole('button', { name: /^Split( into \d+ PDFs?)?$/ });

async function chooseMode(page: Page, mode: 'Every page' | 'Every N pages' | 'Custom ranges') {
  await page.getByRole('radio', { name: mode }).click();
  await expect(page.getByRole('radio', { name: mode })).toBeChecked();
}

test.beforeEach(async ({ page }) => {
  await page.goto('split-pdf');
});

test('custom ranges 1-3, 5, 8-10 make three PDFs with the right pages', async ({ page }) => {
  await pick(page, 'report.pdf', await numberedPdf(10));
  await expect(tiles(page)).toHaveCount(10);
  await chooseMode(page, 'Custom ranges');
  await rangesField(page).fill('1-3, 5, 8-10');
  await expect(page.getByText('Makes 3 PDFs')).toBeVisible();
  await expect(tiles(page).and(page.locator('[data-picked]'))).toHaveCount(7);

  await splitButton(page).click();
  await expect(parts(page)).toHaveCount(3, { timeout: 20_000 });
  await expect(parts(page).locator('span[title]')).toHaveText([
    'report-p1-3.pdf',
    'report-p5.pdf',
    'report-p8-10.pdf',
  ]);
  await expect(parts(page).nth(1)).toContainText('1 page ·');

  const expected = [[1, 2, 3], [5], [8, 9, 10]];
  for (const [i, name] of ['report-p1-3.pdf', 'report-p5.pdf', 'report-p8-10.pdf'].entries()) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download ${name}` }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(name);
    expect(await pageNumbers(await downloaded(download))).toEqual(expected[i]);
  }
});

test('invalid ranges show the exact message and disable Split', async ({ page }) => {
  await pick(page, 'report.pdf', await numberedPdf(10));
  await chooseMode(page, 'Custom ranges');
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
    await expect(splitButton(page)).toBeDisabled();
  }

  await field.fill('');
  await expect(page.getByText('Enter the pages you want, like 1-3, 5, 8-10')).toBeVisible();
  await expect(splitButton(page)).toBeDisabled();

  // Clicking thumbnails adds and removes pages.
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.getByRole('button', { name: /^Page 3\b/ }).click();
  await page.getByRole('button', { name: /^Page 7\b/ }).click();
  await expect(field).toHaveValue('2-3, 7');
  await expect(page.getByRole('button', { name: /^Page 3\b/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: /^Page 2\b/ }).click();
  await expect(field).toHaveValue('3, 7');
  await expect(splitButton(page)).toHaveText('Split into 2 PDFs');
  await expect(splitButton(page)).toBeEnabled();
});

test('every N pages', async ({ page }) => {
  await pick(page, 'report.pdf', await numberedPdf(10));
  await expect(tiles(page)).toHaveCount(10);
  await chooseMode(page, 'Every N pages');
  await page.getByLabel('Pages per part').fill('4');
  await expect(splitButton(page)).toHaveText('Split into 3 PDFs');
  await splitButton(page).click();
  await expect(parts(page).locator('span[title]')).toHaveText(
    ['report-p1-4.pdf', 'report-p5-8.pdf', 'report-p9-10.pdf'],
    { timeout: 20_000 },
  );
});

test('every page of a 100-page PDF → a ZIP of 100 PDFs with unique names', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await pick(page, 'big.pdf', await numberedPdf(100));
  await expect(tiles(page)).toHaveCount(100);
  // Thumbnails load progressively: the first ones render, pages far below wait their turn.
  await expect(tiles(page).first().locator('[data-state="ready"]')).toBeVisible();
  await expect(tiles(page).last().locator('[data-state="loading"]')).toBeAttached();

  await chooseMode(page, 'Every page');
  await expect(splitButton(page)).toHaveText('Split into 100 PDFs');
  await splitButton(page).click();
  await expect(parts(page)).toHaveCount(100, { timeout: 60_000 });

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all 100 as ZIP' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('big-split.zip');

  const entries = unzipSync(await downloaded(download));
  const names = Object.keys(entries);
  expect(names).toHaveLength(100);
  expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(100);
  expect(names).toContain('big-p1.pdf');
  expect(names).toContain('big-p100.pdf');
  expect(await pageNumbers(entries['big-p1.pdf']!)).toEqual([1]);
  expect(await pageNumbers(entries['big-p57.pdf']!)).toEqual([57]);

  // Leaving the page stops the thumbnail rendering without errors.
  await page.getByRole('link', { name: 'All tools' }).first().click();
  await expect(page).toHaveURL(/\/snap-convert\/$/);
  expect(errors).toEqual([]);
});

test('a password-protected PDF cannot be split', async ({ page }) => {
  const encrypted = readFileSync(path.resolve('tests/fixtures/pdf/encrypted.pdf'));
  await pick(page, 'locked.pdf', encrypted);
  await expect(page.getByText("This PDF is password-protected — it can't be split.")).toBeVisible();
  await expect(splitButton(page)).toBeDisabled();
});

test('sample PDF loads with page thumbnails', async ({ page }) => {
  await page.getByRole('button', { name: 'Try with a sample PDF' }).click();
  await expect(tiles(page)).toHaveCount(10);
  await expect(tiles(page).first().locator('[data-state="ready"] canvas')).toBeVisible();

  const results = await new AxeBuilder({ page }).include('main').analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});
