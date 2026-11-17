// Resize PDF (P20): every page onto one paper size, content scaled uniformly (x = y), centred,
// text still selectable. Outputs are read back with pdf-lib (sizes, drawing matrices) and pdf.js
// (selectable text).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFPage } from 'pdf-lib';

const A4 = { width: 595.28, height: 841.89 };
const LETTER = { width: 612, height: 792 };

const fixture = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: readFileSync(path.resolve('tests/fixtures/pdf', name)),
});

async function open(page: Page, names: string[]) {
  await page.goto('resize-pdf');
  await expect(page.getByTestId('resize-pdf')).toHaveAttribute('data-live', 'true');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop PDF files here/ }).click();
  await (await chooser).setFiles(names.map(fixture));
  await expect(page.getByTestId('resize-row')).toHaveCount(names.length);
}

async function chooseSize(page: Page, option: RegExp) {
  await page.getByRole('combobox', { name: 'Page size' }).click();
  await page.getByRole('option', { name: option }).click();
}

async function resize(page: Page, files: number) {
  await page.getByRole('button', { name: `Resize ${files} PDF${files === 1 ? '' : 's'}` }).click();
  await expect(page.getByTestId('resize-result')).toBeVisible({ timeout: 30_000 });
}

async function download(page: Page, name: string | RegExp) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: typeof name === 'string' }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** The `a b c d e f cm /Name Do` drawings on a page. */
function drawings(page: PDFPage): number[][] {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => page.doc.context.lookup(ref))
      : [contents];
  const text = streams
    .map((s) =>
      s instanceof PDFRawStream
        ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode())
        : '',
    )
    .join('\n');
  return [...text.matchAll(/((?:-?[\d.]+\s+){6})cm\s+\/\S+\s+Do/g)].map((m) =>
    (m[1] ?? '').trim().split(/\s+/).map(Number),
  );
}

/**
 * Checks one output page: its size, one drawing with the same scale on x and y, and the drawn
 * content (`content` = the source page's unrotated size) centred on the page.
 */
function expectPlaced(page: PDFPage, size: { width: number; height: number }, content: typeof A4) {
  expect(page.getWidth()).toBeCloseTo(size.width, 1);
  expect(page.getHeight()).toBeCloseTo(size.height, 1);
  const [m] = drawings(page);
  expect(m).toHaveLength(6);
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m ?? [];
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);
  expect(sx).toBeCloseTo(sy, 6); // uniform: never stretched
  // Corners of the drawn content on the page.
  const xs = [
    e,
    e + a * content.width,
    e + c * content.height,
    e + a * content.width + c * content.height,
  ];
  const ys = [
    f,
    f + b * content.width,
    f + d * content.height,
    f + b * content.width + d * content.height,
  ];
  const left = Math.min(...xs);
  const right = size.width - Math.max(...xs);
  const bottom = Math.min(...ys);
  const top = size.height - Math.max(...ys);
  expect(left).toBeCloseTo(right, 1);
  expect(bottom).toBeCloseTo(top, 1);
  expect(Math.min(left, right, top, bottom)).toBeGreaterThanOrEqual(-0.01);
  // Fills the page on at least one axis.
  expect(Math.min(left + right, top + bottom)).toBeLessThan(0.05);
  return sx;
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
  }
  await task.destroy();
  return texts;
}

test('A4 → Letter: preview, uniform scale, centred, text still selectable', async ({ page }) => {
  await open(page, ['a4-3-pages.pdf']);
  await chooseSize(page, /^Letter/);

  // Preview: Letter page, A4 content fitted and centred on it (exactPlacement, never stretched).
  const paper = await page.getByTestId('preview-page').boundingBox();
  const content = await page.getByTestId('preview-content').boundingBox();
  if (!paper || !content) throw new Error('preview not shown');
  expect(paper.width / paper.height).toBeCloseTo(LETTER.width / LETTER.height, 1);
  expect(content.width / content.height).toBeCloseTo(A4.width / A4.height, 1);
  const leftGap = content.x - paper.x;
  const rightGap = paper.x + paper.width - (content.x + content.width);
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1.5);
  await expect(page.getByText('Content scaled to 94%, centred')).toBeVisible();

  await resize(page, 1);
  await expect(page.getByTestId('resize-row')).toContainText('A4 → Letter');
  const file = await download(page, 'Download');
  expect(file.name).toBe('a4-3-pages-letter.pdf');

  const doc = await PDFDocument.load(file.bytes);
  expect(doc.getPageCount()).toBe(3);
  for (const p of doc.getPages()) {
    const scale = expectPlaced(p, LETTER, A4);
    expect(scale).toBeCloseTo(792 / 841.89, 3);
  }
  expect(await pageTexts(file.bytes)).toEqual([
    'A4 page 1 of 3',
    'A4 page 2 of 3',
    'A4 page 3 of 3',
  ]);
});

test('Letter → A4: landscape pages stay landscape, scaled uniformly and centred', async ({
  page,
}) => {
  await open(page, ['letter-landscape-2-pages.pdf']);
  await chooseSize(page, /^A4/);
  await resize(page, 1);
  const file = await download(page, 'Download');
  expect(file.name).toBe('letter-landscape-2-pages-a4.pdf');

  const doc = await PDFDocument.load(file.bytes);
  expect(doc.getPageCount()).toBe(2);
  const landscapeA4 = { width: A4.height, height: A4.width };
  for (const p of doc.getPages()) {
    const scale = expectPlaced(p, landscapeA4, { width: 792, height: 612 });
    expect(scale).toBeCloseTo(595.28 / 612, 3);
  }
  const texts = await pageTexts(file.bytes);
  expect(texts.every((text) => text.length > 0)).toBe(true);
});

test('mixed sizes with Auto keep each page’s orientation; two PDFs download as a ZIP', async ({
  page,
}) => {
  await open(page, ['mixed-4-pages.pdf', 'a4-3-pages.pdf']);
  await chooseSize(page, /^Letter/);
  await expect(page.getByTestId('resize-row').first()).toContainText('mixed sizes → Letter');
  await resize(page, 2);

  const zip = await download(page, 'Download all 2 as ZIP');
  expect(zip.name).toBe('resized-pdfs.zip');
  const entries = unzipSync(new Uint8Array(zip.bytes));
  expect(Object.keys(entries).sort()).toEqual([
    'a4-3-pages-letter.pdf',
    'mixed-4-pages-letter.pdf',
  ]);

  const mixed = await PDFDocument.load(entries['mixed-4-pages-letter.pdf']!);
  const sizes = mixed.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
  // A5 portrait, Legal portrait, A4 shown landscape (/Rotate 90), 300×300 square (portrait).
  expect(sizes).toEqual([
    [612, 792],
    [612, 792],
    [792, 612],
    [612, 792],
  ]);
  for (const p of mixed.getPages()) {
    const [m] = drawings(p);
    const [a = 0, b = 0, c = 0, d = 0] = m ?? [];
    expect(Math.hypot(a, b)).toBeCloseTo(Math.hypot(c, d), 6);
  }

  const a4 = await PDFDocument.load(entries['a4-3-pages-letter.pdf']!);
  for (const p of a4.getPages()) expectPlaced(p, LETTER, A4);

  // Each file also downloads on its own.
  const single = await download(page, 'Download a4-3-pages-letter.pdf');
  expect(single.name).toBe('a4-3-pages-letter.pdf');

  // Changing a setting makes the results out of date: Resize comes back.
  await chooseSize(page, /^Legal/);
  await expect(page.getByTestId('resize-result')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resize 2 PDFs' })).toBeEnabled();
});

test('a password-protected PDF is explained and left out', async ({ page }) => {
  await open(page, ['encrypted.pdf', 'a4-3-pages.pdf']);
  const locked = page.getByTestId('resize-row').filter({ hasText: 'encrypted.pdf' });
  await expect(locked).toContainText('Password-protected');
  await expect(locked).toContainText('Remove the password');
  await resize(page, 1);
  await expect(page.getByTestId('resize-result')).toContainText('Your PDF is ready');
});

test('custom size in inches', async ({ page }) => {
  await open(page, ['a4-3-pages.pdf']);
  await chooseSize(page, /^Custom/);
  await page.getByRole('radio', { name: 'in', exact: true }).click();
  await page.getByLabel('Width').fill('5');
  await page.getByLabel('Height').fill('5');
  await page.getByLabel('Height').blur();
  await resize(page, 1);
  const file = await download(page, 'Download');
  const doc = await PDFDocument.load(file.bytes);
  for (const p of doc.getPages()) expectPlaced(p, { width: 360, height: 360 }, A4);
});

test('the workspace has no serious accessibility issues', async ({ page }) => {
  await open(page, ['encrypted.pdf', 'a4-3-pages.pdf']);
  await expect(page.getByTestId('preview-page')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  // The DropZone naming issue was fixed in P11b, so nothing is filtered.
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});
