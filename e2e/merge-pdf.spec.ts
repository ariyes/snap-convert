// Merge PDF (P19): order, reorder (keyboard, mouse, touch), password-protected files, samples.
// Every merged PDF is opened with pdf-lib here to check its pages.
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Locator, type Page } from './support/test';
import { PDFDocument } from 'pdf-lib';

const A4 = 'a4-3-pages.pdf';
const LETTER = 'letter-landscape-2-pages.pdf';
const MIXED = 'mixed-4-pages.pdf';
const TEN = 'ten-pages.pdf';
const ENCRYPTED = 'encrypted.pdf';

const bytes = (name: string) => readFileSync(path.resolve('tests/fixtures/pdf', name));
const fixture = (name: string) => ({ name, mimeType: 'application/pdf', buffer: bytes(name) });

/** Each page as "width x height @ rotation" — page sizes and turns must survive the merge. */
async function pageSizes(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  return doc
    .getPages()
    .map(
      (p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}@${p.getRotation().angle}`,
    );
}

async function expectedSizes(order: string[]): Promise<string[]> {
  const all = await Promise.all(order.map((name) => pageSizes(bytes(name))));
  return all.flat();
}

async function downloaded(download: Download): Promise<Uint8Array> {
  const file = await download.path();
  return new Uint8Array(await readFile(file));
}

const cards = (page: Page) => page.getByTestId('merge-card');
const cardNames = (page: Page) => cards(page).locator('div[title]');
const mergeButton = (page: Page) => page.getByRole('button', { name: /^Merge \d+ PDFs$/ });

async function pick(page: Page, names: string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop PDF files here/ }).click();
  await (await chooser).setFiles(names.map(fixture));
}

/** Adds the four fixtures and waits until every card is read. */
async function addFour(page: Page) {
  await pick(page, [A4, LETTER, MIXED, TEN]);
  await expect(cardNames(page)).toHaveText([A4, LETTER, MIXED, TEN]);
  await expect(mergeButton(page)).toHaveText('Merge 4 PDFs');
  await expect(mergeButton(page)).toBeEnabled();
}

async function mergeAndDownload(page: Page): Promise<{ pdf: Uint8Array; name: string }> {
  await mergeButton(page).click();
  const downloadButton = page.getByRole('button', { name: 'Download PDF' });
  await expect(downloadButton).toBeVisible({ timeout: 20_000 });
  const downloading = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloading;
  return { pdf: await downloaded(download), name: download.suggestedFilename() };
}

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto('merge-pdf');
});

test('merges four PDFs in a custom order, keeping page sizes', async ({ page }) => {
  await addFour(page);
  await expect(page.getByText(/^· 19 pages · /)).toBeVisible();

  // Keyboard: the buttons move a file, keep focus and announce the move.
  const tenEarlier = page.getByRole('button', { name: `Move ${TEN} earlier` });
  for (let i = 0; i < 3; i++) {
    await tenEarlier.focus();
    await page.keyboard.press('Enter');
  }
  await expect(cardNames(page)).toHaveText([TEN, A4, LETTER, MIXED]);
  // At the start the "earlier" button is off, so focus moves to its partner.
  await expect(page.getByRole('button', { name: `Move ${TEN} later` })).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'moved to' })).toHaveText(
    `${TEN} moved to position 1 of 4`,
  );

  const a4Later = page.getByRole('button', { name: `Move ${A4} later` });
  await a4Later.focus();
  await page.keyboard.press('Enter');
  await expect(cardNames(page)).toHaveText([TEN, LETTER, A4, MIXED]);
  await expect(a4Later).toBeFocused();

  await page.getByLabel('File name').fill('my documents');
  const { pdf, name } = await mergeAndDownload(page);
  // The page names it "my documents.pdf"; WebKit on Linux (CI) swaps the space for "_" when saving.
  expect(name).toMatch(/^my[ _]documents\.pdf$/);
  expect(await pageSizes(pdf)).toEqual(await expectedSizes([TEN, LETTER, A4, MIXED]));
  await expect(page.getByText(/^19 pages · /)).toBeVisible();
});

test('drag with the mouse reorders', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse drag is checked on desktop');
  await addFour(page);

  const from = await centre(cards(page).nth(3));
  const to = await centre(cards(page).nth(0));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 20, from.y, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(cards(page).nth(0)).toHaveAttribute('data-drop-target', 'true');
  await page.mouse.up();

  await expect(cardNames(page)).toHaveText([TEN, A4, LETTER, MIXED]);
  const { pdf } = await mergeAndDownload(page);
  expect(await pageSizes(pdf)).toEqual(await expectedSizes([TEN, A4, LETTER, MIXED]));
});

test('drag with touch reorders after a short hold', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch drag is checked on phones');
  await addFour(page);

  // Bring the first two rows on screen (two cards per row on phones).
  await cards(page)
    .nth(0)
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const card = cards(page).nth(2);
  const from = await centre(card);
  const to = await centre(cards(page).nth(0));
  const touch = { pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true };

  // A quick swipe (no hold) scrolls instead of dragging.
  await card.dispatchEvent('pointerdown', { ...touch, clientX: from.x, clientY: from.y });
  await page.evaluate(
    ([init, x, y]) =>
      window.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x, clientY: y })),
    [touch, from.x, from.y - 40] as const,
  );
  await page.evaluate(([init]) => window.dispatchEvent(new PointerEvent('pointerup', init)), [
    touch,
  ] as const);
  await expect(cardNames(page)).toHaveText([A4, LETTER, MIXED, TEN]);

  // Hold, then drag.
  await card.dispatchEvent('pointerdown', { ...touch, clientX: from.x, clientY: from.y });
  await page.waitForTimeout(600);
  await expect(card).toHaveAttribute('data-dragging', 'true');
  for (const f of [0.3, 0.7, 1]) {
    await page.evaluate(
      ([init, x, y]) =>
        window.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x, clientY: y })),
      [touch, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f] as const,
    );
  }
  await expect(cards(page).nth(0)).toHaveAttribute('data-drop-target', 'true');
  await page.evaluate(
    ([init, x, y]) =>
      window.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: x, clientY: y })),
    [touch, to.x, to.y] as const,
  );

  await expect(cardNames(page)).toHaveText([MIXED, A4, LETTER, TEN]);
  await expect(page.getByRole('status').filter({ hasText: 'moved to' })).toHaveText(
    `${MIXED} moved to position 1 of 4`,
  );
});

test('password-protected PDFs are shown but left out', async ({ page }) => {
  await pick(page, [A4, ENCRYPTED, LETTER]);
  const locked = cards(page).filter({ hasText: ENCRYPTED });
  await expect(locked).toContainText("Password-protected — can't be merged");
  await expect(mergeButton(page)).toHaveText('Merge 2 PDFs');
  await expect(page.locator('strong', { hasText: /^2 PDFs · 5 pages · / })).toBeVisible();

  const { pdf } = await mergeAndDownload(page);
  expect(await pageSizes(pdf)).toEqual(await expectedSizes([A4, LETTER]));
});

test('removing files updates the list; one PDF is not enough', async ({ page }) => {
  await pick(page, [A4, LETTER]);
  await expect(mergeButton(page)).toBeEnabled();
  await page.getByRole('button', { name: `Remove ${A4}` }).click();
  await expect(cardNames(page)).toHaveText([LETTER]);
  await expect(page.getByText('Add at least two PDFs to merge.')).toBeVisible();
  await expect(mergeButton(page)).toBeDisabled();

  // More files can be added from the add tile.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add PDFs' }).click();
  await (await chooser).setFiles([fixture(TEN)]);
  await expect(cardNames(page)).toHaveText([LETTER, TEN]);
  await expect(mergeButton(page)).toHaveText('Merge 2 PDFs');
});

test('sample PDFs load with thumbnails and merge', async ({ page }) => {
  await page.getByRole('button', { name: 'Try with 4 sample PDFs' }).click();
  await expect(cardNames(page)).toHaveText([
    'invoice-march.pdf',
    'contract-signed.pdf',
    'scanned-receipts.pdf',
    'brochure-2026.pdf',
  ]);
  await expect(page.getByText(/^· 37 pages · /)).toBeVisible();
  // Real first-page thumbnails (P08).
  await expect(cards(page).locator('[data-state="ready"] canvas')).toHaveCount(4);

  const results = await new AxeBuilder({ page }).include('main').analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);

  const { pdf, name } = await mergeAndDownload(page);
  expect(name).toBe('merged.pdf');
  const doc = await PDFDocument.load(pdf);
  expect(doc.getPageCount()).toBe(37);
});
