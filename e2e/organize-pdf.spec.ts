// Organize pages (P20): reorder, rotate and delete pages of a 12-page PDF with mouse, keyboard
// and touch; undo/redo every step; the saved PDF (read back with pdf-lib) has exactly the pages
// shown.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from './support/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

interface Shown {
  page: number;
  rotate: number;
}

/** 12 pages; page n is (400 + 10n) × 600 pt, so each output page can be traced to its original. */
async function twelvePages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 12; n++) {
    const page = doc.addPage([400 + 10 * n, 600]);
    page.drawText(`Page ${n}`, { x: 40, y: 520, size: 36, font });
  }
  return Buffer.from(await doc.save());
}

const widthToPage = (width: number) => Math.round((width - 400) / 10);

const dropZone = (page: Page) => page.getByRole('button', { name: /^Drop a PDF here/ });
const options = (page: Page) => page.getByRole('option');
const tile = (page: Page, original: number) =>
  page.locator(`[role="option"][data-page="${original}"]`);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function open(page: Page, file: { name: string; buffer: Buffer }) {
  await page.goto('organize-pdf');
  await expect(page.getByTestId('organize-pdf')).toHaveAttribute('data-live', 'true');
  const chooser = page.waitForEvent('filechooser');
  await dropZone(page).click();
  await (await chooser).setFiles({ ...file, mimeType: 'application/pdf' });
}

async function shown(page: Page): Promise<Shown[]> {
  return options(page).evaluateAll((els) =>
    els.map((el) => ({
      page: Number(el.getAttribute('data-page')),
      rotate: Number(el.getAttribute('data-rotate')),
    })),
  );
}

const order = (list: number[], rotations: Record<number, number> = {}): Shown[] =>
  list.map((page) => ({ page, rotate: rotations[page] ?? 0 }));

async function expectShown(page: Page, expected: Shown[]) {
  await expect.poll(() => shown(page)).toEqual(expected);
}

/** Mouse drag from the middle of `from` to just inside the left edge of `to`. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('tile not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const x = b.x + 8;
  const y = b.y + b.height / 2;
  await page.mouse.move((a.x + x) / 2, (a.y + y) / 2, { steps: 5 });
  await page.mouse.move(x, y, { steps: 5 });
  await expect(page.getByTestId('drop-marker')).toBeVisible();
  await page.mouse.up();
}

async function savedPdf(page: Page): Promise<{ name: string; pages: Shown[] }> {
  await page.getByRole('button', { name: 'Save PDF' }).click();
  await expect(page.getByTestId('organize-result')).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const file = await download;
  const bytes = readFileSync(await file.path());
  const doc = await PDFDocument.load(bytes);
  return {
    name: file.suggestedFilename(),
    pages: doc.getPages().map((p) => ({
      page: widthToPage(p.getWidth()),
      rotate: p.getRotation().angle,
    })),
  };
}

test('reorder, rotate and delete with the mouse; undo and redo every step; save', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('phone'), 'mouse drag and modifier clicks are desktop');
  await open(page, { name: 'twelve.pdf', buffer: await twelvePages() });
  await expect(options(page)).toHaveCount(12);

  const steps: Shown[][] = [order([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])];
  await expectShown(page, steps[0]!);

  // 1. Shift-click range, move to end.
  await tile(page, 1).click();
  await tile(page, 3).click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 selected')).toBeVisible();
  await button(page, 'Move to end').click();
  steps.push(order([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]));
  await expectShown(page, steps.at(-1)!);

  // 2. Ctrl-click two pages, rotate right.
  await tile(page, 5).click();
  await tile(page, 7).click({ modifiers: ['ControlOrMeta'] });
  await expect(tile(page, 5)).toHaveAttribute('aria-selected', 'true');
  await expect(tile(page, 7)).toHaveAttribute('aria-selected', 'true');
  await button(page, 'Rotate right').click();
  steps.push(order([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3], { 5: 90, 7: 90 }));
  await expectShown(page, steps.at(-1)!);

  // 3. Rotate one page left.
  await tile(page, 8).click();
  await button(page, 'Rotate left').click();
  steps.push(order([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3], { 5: 90, 7: 90, 8: 270 }));
  await expectShown(page, steps.at(-1)!);

  // 4. Delete a page.
  await tile(page, 10).click();
  await button(page, 'Delete').click();
  steps.push(order([4, 5, 6, 7, 8, 9, 11, 12, 1, 2, 3], { 5: 90, 7: 90, 8: 270 }));
  await expectShown(page, steps.at(-1)!);
  await expect(page.getByText('11 pages (of 12)')).toBeVisible();

  // 5. Drag page 12 to the start.
  await drag(page, tile(page, 12), tile(page, 4));
  steps.push(order([12, 4, 5, 6, 7, 8, 9, 11, 1, 2, 3], { 5: 90, 7: 90, 8: 270 }));
  await expectShown(page, steps.at(-1)!);

  // Undo every step, then redo every step (buttons and keyboard).
  for (let i = steps.length - 2; i >= 0; i--) {
    if (i % 2) await button(page, 'Undo').click();
    else await page.keyboard.press('ControlOrMeta+z');
    await expectShown(page, steps[i]!);
  }
  await expect(button(page, 'Undo')).toBeDisabled();
  for (let i = 1; i < steps.length; i++) {
    if (i % 2) await button(page, 'Redo').click();
    else await page.keyboard.press('ControlOrMeta+Shift+z');
    await expectShown(page, steps[i]!);
  }
  await expect(button(page, 'Redo')).toBeDisabled();

  const saved = await savedPdf(page);
  expect(saved.name).toBe('twelve-organized.pdf');
  expect(saved.pages).toEqual(steps.at(-1));

  // Editing again makes the result out of date: Save comes back.
  await tile(page, 12).click();
  await button(page, 'Rotate right').click();
  await expect(page.getByTestId('organize-result')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save PDF' })).toBeEnabled();
});

test('the keyboard selects, moves and deletes pages', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('phone'), 'keyboard test runs on desktop');
  await open(page, { name: 'twelve.pdf', buffer: await twelvePages() });
  await expect(options(page)).toHaveCount(12);

  await tile(page, 1).focus();
  await page.keyboard.press('ArrowRight'); // focus page 2
  await expect(tile(page, 2)).toBeFocused();
  await page.keyboard.press('Space'); // select 2
  await page.keyboard.press('Shift+ArrowRight'); // select 2–3
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight'); // move 2–3 one later
  await expectShown(page, order([1, 4, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]));
  await page.keyboard.press('Delete');
  await expectShown(page, order([1, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByText('10 selected')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('None selected')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expectShown(page, order([1, 4, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]));
  await page.keyboard.press('ControlOrMeta+z');
  await expectShown(page, order([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));

  const saved = await savedPdf(page);
  expect(saved.pages).toEqual(order([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
});

/** A touch press on a tile, held for `ms`. */
async function touch(target: Locator, ms: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error('tile not visible');
  const init = {
    pointerType: 'touch',
    pointerId: 7,
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  };
  await target.dispatchEvent('pointerdown', init);
  await target.page().waitForTimeout(ms);
  await target.dispatchEvent('pointerup', init);
}

test('touch: long-press selects, then taps add pages; delete and save', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('phone'), 'touch test runs on phones');
  await open(page, { name: 'twelve.pdf', buffer: await twelvePages() });
  await expect(options(page)).toHaveCount(12);

  await touch(tile(page, 2), 700);
  await expect(tile(page, 2)).toHaveAttribute('aria-selected', 'true');
  await touch(tile(page, 4), 50);
  await touch(tile(page, 6), 50);
  await expect(page.getByText('3 selected')).toBeVisible();
  await touch(tile(page, 4), 50); // tapping again removes it
  await expect(tile(page, 4)).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByText('2 selected')).toBeVisible();

  await button(page, 'Delete').click();
  await expectShown(page, order([1, 3, 4, 5, 7, 8, 9, 10, 11, 12]));
  await button(page, 'Undo').click();
  await expectShown(page, order([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  await button(page, 'Redo').click();

  const saved = await savedPdf(page);
  expect(saved.pages).toEqual(order([1, 3, 4, 5, 7, 8, 9, 10, 11, 12]));
});

test('a password-protected PDF is explained', async ({ page }) => {
  await open(page, {
    name: 'locked.pdf',
    buffer: readFileSync(path.resolve('tests/fixtures/pdf/encrypted.pdf')),
  });
  await expect(page.getByRole('alert')).toContainText('password-protected');
  await expect(options(page)).toHaveCount(0);
});

test('the page grid has no serious accessibility issues', async ({ page }) => {
  await open(page, { name: 'twelve.pdf', buffer: await twelvePages() });
  await expect(options(page)).toHaveCount(12);
  await tile(page, 2).click();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});
