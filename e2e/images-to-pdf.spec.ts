// Images to PDF (P18): drop images, order them, build the PDF in the workers, and check the PDF
// itself with pdf-lib — page count, order, page orientation, image boxes never stretched, JPEG
// bytes embedded unchanged, and "Smaller file" really smaller and still crisp.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import type { PDFNumber } from 'pdf-lib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  type PDFPage,
} from 'pdf-lib';

interface Fixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const fixture = (file: string, name = path.basename(file), mimeType = ''): Fixture => ({
  name,
  mimeType,
  buffer: readFileSync(path.resolve('tests/fixtures', file)),
});

/** A plain image made in the page with a canvas (for portrait images, which the fixtures lack). */
async function drawn(
  page: Page,
  name: string,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg',
): Promise<Fixture> {
  const base64 = await page.evaluate(
    async ({ width, height, type }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(0, 0, width / 2, height / 3);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no blob'))), type, 0.9),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    },
    { width, height, type },
  );
  return { name, mimeType: type, buffer: Buffer.from(base64, 'base64') };
}

const dropZone = (page: Page) => page.getByRole('button', { name: /^Drop images here/ });
const cards = (page: Page) =>
  page.getByRole('list', { name: 'Pages, in order' }).getByRole('listitem');
const makeButton = (page: Page) => page.getByRole('button', { name: /^Make PDF/ }).first();
const downloadButton = (page: Page) => page.getByRole('button', { name: 'Download PDF' }).first();

async function open(page: Page) {
  await page.goto('images-to-pdf');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Images to PDF');
}

async function pick(page: Page, files: Fixture[]) {
  const chooser = page.waitForEvent('filechooser');
  await dropZone(page).click();
  await (await chooser).setFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

/** Card names in order (the visible file name of each card). */
async function cardNames(page: Page): Promise<string[]> {
  return cards(page)
    .locator('[title]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''));
}

/** Clicks Make PDF, waits for the result and returns the downloaded PDF's bytes. */
async function makeAndDownload(page: Page): Promise<Buffer> {
  await makeButton(page).click();
  await expect(page.getByTestId('pdf-result')).toBeVisible({ timeout: 90_000 });
  const download = page.waitForEvent('download');
  await downloadButton(page).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  return readFileSync(await file.path());
}

interface DrawnImage {
  /** Image XObject size in pixels, as stored. */
  pixels: { width: number; height: number };
  /** Drawing matrix [a b c d e f] of the image on the page. */
  matrix: number[];
  /** Box the image covers on the page, in points. */
  box: { x: number; y: number; width: number; height: number };
  /** The XObject's stored bytes and filter. */
  bytes: Uint8Array;
  filter: string | undefined;
}

function contentText(page: PDFPage): string {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((r) => page.doc.context.lookup(r))
      : [contents];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) return '';
      const filter = s.dict.get(PDFName.of('Filter'));
      const raw = Buffer.from(s.contents);
      return (filter === PDFName.of('FlateDecode') ? inflateSync(raw) : raw).toString('latin1');
    })
    .join('\n');
}

/** The one image drawn on a page: its XObject and where it's drawn. */
function imageOn(page: PDFPage): DrawnImage {
  const text = contentText(page);
  const match = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/(\S+) Do/.exec(
    text,
  );
  if (!match) throw new Error(`No image drawn on the page:\n${text}`);
  const matrix = match.slice(1, 7).map(Number);
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = matrix;
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  const ref = xobjects?.get(PDFName.of(match[7] ?? ''));
  const stream = ref instanceof PDFRef ? page.doc.context.lookup(ref) : undefined;
  if (!(stream instanceof PDFRawStream)) throw new Error('Image XObject missing');
  const num = (key: string) => (stream.dict.get(PDFName.of(key)) as PDFNumber).asNumber();
  const filter = stream.dict.get(PDFName.of('Filter'));
  // The unit square's corners under the matrix give the drawn box.
  const xs = [e, a + e, c + e, a + c + e];
  const ys = [f, b + f, d + f, b + d + f];
  return {
    pixels: { width: num('Width'), height: num('Height') },
    matrix,
    box: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
    bytes: stream.contents,
    filter: filter instanceof PDFName ? filter.decodeText() : undefined,
  };
}

/** The image as shown: a quarter turn in the matrix (b, c ≠ 0) swaps its width and height. */
function shownRatio(img: DrawnImage): number {
  const turned = Math.abs(img.matrix[1] ?? 0) > 1e-6;
  return turned ? img.pixels.height / img.pixels.width : img.pixels.width / img.pixels.height;
}

/** Never stretched: the drawn box has the image's own proportions (within rounding). */
function expectNotStretched(img: DrawnImage) {
  const drawnRatio = img.box.width / img.box.height;
  expect(Math.abs(drawnRatio / shownRatio(img) - 1)).toBeLessThan(0.002);
}

test.describe.configure({ timeout: 180_000 });

test(
  'ten mixed images become a ten-page PDF in the chosen order, never stretched',
  { tag: '@firefox-ci-crash' },
  async ({ page }) => {
    await open(page);
    const tallJpg = await drawn(page, 'tall.jpg', 60, 100, 'image/jpeg');
    const tallPng = await drawn(page, 'tall.png', 50, 120, 'image/png');
    const files = [
      tallJpg, // portrait JPEG
      fixture('images/orientation-6.jpg'), // stored portrait, upright landscape (EXIF 6)
      fixture('images/iphone-7.heic'), // HEIC, landscape
      fixture('images/alpha.png'), // transparent PNG, landscape
      fixture('quality/photo-portrait-exif-rotated.jpg'), // phone photo, portrait after EXIF 6
      fixture('images/sample.webp'),
      fixture('images/sample.avif'),
      fixture('intake/webp-alpha.webp'), // transparent WebP
      fixture('images/sample.gif'),
      tallPng, // portrait PNG
    ];
    /** Upright (shown) size of each file, by name. */
    const upright: Record<string, [number, number]> = {
      'tall.jpg': [60, 100],
      'orientation-6.jpg': [96, 64],
      'iphone-7.heic': [4032, 3024],
      'alpha.png': [90, 60],
      'photo-portrait-exif-rotated.jpg': [2448, 3264],
      'sample.webp': [80, 60],
      'sample.avif': [80, 60],
      'webp-alpha.webp': [72, 40],
      'sample.gif': [40, 30],
      'tall.png': [50, 120],
    };
    await pick(page, files);

    // The HEIC card gets its preview from the image worker.
    const heicCard = cards(page).filter({ hasText: 'iphone-7.heic' });
    await expect(heicCard.locator('img')).toBeVisible({ timeout: 90_000 });

    // Reorder by keyboard: tall.png to the front, then alpha.png one later.
    const earlier = page.getByRole('button', { name: 'Move tall.png earlier' });
    await earlier.focus();
    for (let i = 0; i < 9; i++) await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'tall.png moved to page 1 of 10' }),
    ).toBeAttached();
    await expect(page.getByRole('button', { name: 'Move tall.png later' })).toBeFocused();
    await page.getByRole('button', { name: 'Move alpha.png later' }).click();

    const order = [
      'tall.png',
      'tall.jpg',
      'orientation-6.jpg',
      'iphone-7.heic',
      'photo-portrait-exif-rotated.jpg',
      'alpha.png',
      'sample.webp',
      'sample.avif',
      'webp-alpha.webp',
      'sample.gif',
    ];
    expect(await cardNames(page)).toEqual(order);

    const doc = await PDFDocument.load(await makeAndDownload(page));
    await expect(page.getByTestId('pdf-result')).toContainText('10 pages');
    const pages = doc.getPages();
    expect(pages).toHaveLength(10);

    pages.forEach((p, i) => {
      const name = order[i] ?? '';
      const [w, h] = upright[name] ?? [1, 1];
      const img = imageOn(p);
      const { width, height } = p.getSize();
      // Auto orientation: the page turns with its image (Letter for the en-US test browser).
      expect([width, height], name).toEqual(w > h ? [792, 612] : [612, 792]);
      // In order: the image drawn is this file's (same proportions when shown upright).
      expect(Math.abs(shownRatio(img) / (w / h) - 1), name).toBeLessThan(0.02);
      expectNotStretched(img);
      // No margin: the image fills the page in one direction and stays inside it.
      const fillsWidth = Math.abs(img.box.width - width) < 0.05;
      const fillsHeight = Math.abs(img.box.height - height) < 0.05;
      expect(fillsWidth || fillsHeight, name).toBe(true);
      expect(img.box.x).toBeGreaterThanOrEqual(-0.01);
      expect(img.box.y).toBeGreaterThanOrEqual(-0.01);
    });

    // PDFs hold only JPEG and PNG: HEIC/WebP/AVIF were converted, transparent ones kept as PNG.
    const filterOf = (name: string) => imageOn(pages[order.indexOf(name)]!).filter;
    expect(filterOf('iphone-7.heic')).toBe('DCTDecode');
    expect(filterOf('sample.webp')).toBe('DCTDecode');
    expect(filterOf('sample.avif')).toBe('DCTDecode');
    expect(filterOf('webp-alpha.webp')).toBe('FlateDecode');
    expect(filterOf('alpha.png')).toBe('FlateDecode');
    expect(filterOf('sample.gif')).toBe('FlateDecode');
  },
);

/** A JPEG's header segments (marker + payload) and its compressed image data (from SOS on). */
function jpegParts(bytes: Uint8Array): { segments: Array<[number, Buffer]>; scan: Buffer } {
  const b = Buffer.from(bytes);
  const segments: Array<[number, Buffer]> = [];
  let at = 2;
  while (at + 4 <= b.length && b[at] === 0xff) {
    const marker = b[at + 1] ?? 0;
    if (marker === 0xda) return { segments, scan: b.subarray(at) };
    const length = b.readUInt16BE(at + 2);
    segments.push([marker, b.subarray(at + 4, at + 2 + length)]);
    at += 2 + length;
  }
  throw new Error('No image data in the JPEG');
}

/** The EXIF orientation of a JPEG (1 when none), and whether its EXIF links a GPS directory. */
function exifOf(bytes: Uint8Array): { orientation: number; gps: boolean } {
  const exif = jpegParts(bytes).segments.find(
    ([m, d]) => m === 0xe1 && d.subarray(0, 6).toString('latin1') === 'Exif\0\0',
  );
  if (!exif) return { orientation: 1, gps: false };
  const tiff = exif[1].subarray(6);
  const little = tiff.readUInt16BE(0) === 0x4949;
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  let orientation = 1;
  let gps = false;
  for (let i = 0; i < u16(ifd); i++) {
    const tag = u16(ifd + 2 + i * 12);
    if (tag === 0x0112) orientation = u16(ifd + 2 + i * 12 + 8);
    if (tag === 0x8825) gps = true;
  }
  return { orientation, gps };
}

test('"Original" embeds JPEG image data unchanged (no re-encode)', async ({ page }) => {
  await open(page);
  const photo = fixture('quality/photo-fine-detail.jpg');
  const rotated = fixture('quality/photo-portrait-exif-rotated.jpg');
  await pick(page, [photo, rotated]);

  const doc = await PDFDocument.load(await makeAndDownload(page));
  for (const [i, file] of [photo, rotated].entries()) {
    const kept = imageOn(doc.getPage(i));
    expect(kept.filter).toBe('DCTDecode');
    // Only header metadata may change (location removed); the compressed pixels are the same.
    expect(jpegParts(kept.bytes).scan.equals(jpegParts(file.buffer).scan)).toBe(true);
    expect(exifOf(kept.bytes).orientation).toBe(exifOf(file.buffer).orientation);
    expectNotStretched(kept);
  }
  // EXIF orientation 6 is applied by the drawing (a quarter turn), so the page is portrait.
  expect(exifOf(rotated.buffer).orientation).toBe(6);
  expect(doc.getPage(1).getSize()).toEqual({ width: 612, height: 792 });
});

test('location data never ends up in the PDF, and pages stay upright', async ({ page }) => {
  await open(page);
  // gps.jpg: 96 × 64 upright test card whose EXIF holds a GPS position (51° 30′ N, 0° 7′ W).
  const located = fixture('images/gps.jpg');
  const rotated = fixture('quality/photo-portrait-exif-rotated.jpg');
  await pick(page, [located, rotated]);
  await expect(page.getByTestId('location-note')).toHaveText(
    'Location data is removed from your photos.',
  );

  /** The GPS latitude rationals as stored (big- or little-endian), and the GPS link in the EXIF. */
  const latitude = (little: boolean) => {
    const b = Buffer.alloc(16);
    [51, 1, 30, 1].forEach((n, i) =>
      little ? b.writeUInt32LE(n, i * 4) : b.writeUInt32BE(n, i * 4),
    );
    return b;
  };
  const hasLatitude = (b: Buffer) => b.includes(latitude(true)) || b.includes(latitude(false));
  expect(hasLatitude(located.buffer)).toBe(true);
  expect(exifOf(located.buffer).gps).toBe(true);

  const pdf = await makeAndDownload(page);
  // Not in the file at all (images are stored uncompressed as JPEG bytes)…
  expect(hasLatitude(pdf)).toBe(false);
  const doc = await PDFDocument.load(pdf);
  const kept = imageOn(doc.getPage(0));
  expect(kept.filter).toBe('DCTDecode');
  // …nor linked from the embedded photo's EXIF; its image data is untouched.
  expect(exifOf(kept.bytes).gps).toBe(false);
  expect(hasLatitude(Buffer.from(kept.bytes))).toBe(false);
  expect(jpegParts(kept.bytes).scan.equals(jpegParts(located.buffer).scan)).toBe(true);

  // Upright: the landscape test card on a landscape page, drawn without a turn…
  expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
  expect(kept.matrix[1]).toBeCloseTo(0);
  expect(kept.matrix[0]).toBeGreaterThan(0);
  expect(kept.matrix[3]).toBeGreaterThan(0);
  expectNotStretched(kept);
  // …and the EXIF-rotated phone photo still turned to portrait.
  expect(exifOf(imageOn(doc.getPage(1)).bytes).orientation).toBe(6);
  expect(doc.getPage(1).getSize()).toEqual({ width: 612, height: 792 });
});

test('"Smaller file" makes a smaller PDF that still looks the same', async ({ page }) => {
  await open(page);
  const photo = fixture('quality/photo-fine-detail.jpg'); // 4032 × 2268
  await pick(page, [photo]);

  const original = await PDFDocument.load(await makeAndDownload(page));
  const originalSize = (await original.save()).length;

  await page.getByRole('radio', { name: 'Smaller file' }).click();
  await expect(makeButton(page)).toBeVisible();
  const smallerBytes = await makeAndDownload(page);
  const smaller = await PDFDocument.load(smallerBytes);
  // The quality guard may raise the quality for a detailed photo, but the file still shrinks.
  expect((await smaller.save()).length).toBeLessThan(originalSize);
  const shrunk = imageOn(smaller.getPage(0));
  expect(shrunk.filter).toBe('DCTDecode');
  expect(shrunk.pixels).toEqual({ width: 2480, height: 1395 });
  expectNotStretched(shrunk);

  // SSIM of the smaller image against the original scaled to the same size by the browser.
  const score = await page.evaluate(
    async ({ a, b }) => {
      const toBlob = (base64: string) =>
        new Blob([Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))], {
          type: 'image/jpeg',
        });
      const small = await createImageBitmap(toBlob(b));
      const { width, height } = small;
      const pixels = (source: ImageBitmap) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height).data;
      };
      const big = await createImageBitmap(toBlob(a));
      const x = pixels(big);
      const y = pixels(small);
      // Luma SSIM over 8 × 8 windows, step 4 (as the app's own quality check).
      const luma = (d: Uint8ClampedArray, i: number) =>
        0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
      const C1 = (0.01 * 255) ** 2;
      const C2 = (0.03 * 255) ** 2;
      let total = 0;
      let count = 0;
      for (let wy = 0; wy + 8 <= height; wy += 4) {
        for (let wx = 0; wx + 8 <= width; wx += 4) {
          let sx = 0;
          let sy = 0;
          let sxx = 0;
          let syy = 0;
          let sxy = 0;
          for (let j = 0; j < 8; j++) {
            for (let k = 0; k < 8; k++) {
              const i = ((wy + j) * width + wx + k) * 4;
              const p = luma(x, i);
              const q = luma(y, i);
              sx += p;
              sy += q;
              sxx += p * p;
              syy += q * q;
              sxy += p * q;
            }
          }
          const mx = sx / 64;
          const my = sy / 64;
          const vx = sxx / 64 - mx * mx;
          const vy = syy / 64 - my * my;
          const cov = sxy / 64 - mx * my;
          total +=
            ((2 * mx * my + C1) * (2 * cov + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
          count++;
        }
      }
      return total / count;
    },
    {
      a: photo.buffer.toString('base64'),
      b: Buffer.from(shrunk.bytes).toString('base64'),
    },
  );
  expect(score).toBeGreaterThanOrEqual(0.97);
});

test('page size, orientation and margin settings shape every page', async ({ page }) => {
  await open(page);
  const wide = fixture('images/opaque.png'); // 90 × 60
  const tall = await drawn(page, 'tall.png', 40, 100, 'image/png');
  await pick(page, [wide, tall]);

  await page.getByLabel('Page size').click();
  await page.getByRole('option', { name: 'A4' }).click();
  await page.getByRole('radio', { name: 'Landscape' }).click();
  await page.getByRole('radio', { name: 'Large' }).click();
  // The live preview follows the settings: A4 landscape (in points) with a margin.
  const preview = page.getByTestId('page-preview').first();
  await expect(preview).toHaveAttribute('data-page-width', '841.89');
  await expect(preview).toHaveAttribute('data-page-height', '595.28');
  await expect(page.getByTestId('page-margin').first()).toBeVisible();

  let doc = await PDFDocument.load(await makeAndDownload(page));
  const margin = (20 * 72) / 25.4;
  for (const p of doc.getPages()) {
    expect(p.getSize()).toEqual({ width: 841.89, height: 595.28 });
    const img = imageOn(p);
    expectNotStretched(img);
    expect(img.box.x).toBeGreaterThanOrEqual(margin - 0.01);
    expect(img.box.y).toBeGreaterThanOrEqual(margin - 0.01);
    expect(img.box.x + img.box.width).toBeLessThanOrEqual(841.89 - margin + 0.01);
    expect(img.box.y + img.box.height).toBeLessThanOrEqual(595.28 - margin + 0.01);
  }

  // Fit to image: each page is its image (1 px = 1 pt) plus the margins.
  await page.getByLabel('Page size').click();
  await page.getByRole('option', { name: 'Fit to image' }).click();
  await page.getByRole('radio', { name: 'None' }).click();
  doc = await PDFDocument.load(await makeAndDownload(page));
  expect(doc.getPages().map((p) => p.getSize())).toEqual([
    { width: 90, height: 60 },
    { width: 40, height: 100 },
  ]);
});

test(
  'reordering by keyboard is announced and keeps focus on the moved card',
  { tag: '@firefox-ci-crash' },
  async ({ page }) => {
    await open(page);
    await pick(page, [
      fixture('images/opaque.png', 'one.png'),
      fixture('images/alpha.png', 'two.png'),
      fixture('images/no-exif.jpg', 'three.jpg'),
    ]);
    expect(await cardNames(page)).toEqual(['one.png', 'two.png', 'three.jpg']);

    const status = page.getByRole('status').filter({ hasText: /moved to page/ });
    await page.getByRole('button', { name: 'Move three.jpg earlier' }).focus();
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('three.jpg moved to page 2 of 3');
    expect(await cardNames(page)).toEqual(['one.png', 'three.jpg', 'two.png']);
    await expect(page.getByRole('button', { name: 'Move three.jpg earlier' })).toBeFocused();

    await page.keyboard.press('Space');
    await expect(status).toHaveText('three.jpg moved to page 1 of 3');
    // At the front "earlier" is disabled, so focus moves to "later" on the same card.
    await expect(page.getByRole('button', { name: 'Move three.jpg later' })).toBeFocused();
    expect(await cardNames(page)).toEqual(['three.jpg', 'one.png', 'two.png']);

    // Order badges follow.
    await expect(cards(page).first()).toContainText('1');
    await page.getByRole('button', { name: 'Remove one.png' }).click();
    expect(await cardNames(page)).toEqual(['three.jpg', 'two.png']);
  },
);

test(
  'cards can be dragged to a new place',
  { tag: '@firefox-ci-crash' },
  async ({ page, isMobile }) => {
    test.skip(isMobile, 'Phones reorder with the move buttons');
    await open(page);
    await pick(page, [
      fixture('images/opaque.png', 'one.png'),
      fixture('images/alpha.png', 'two.png'),
      fixture('images/no-exif.jpg', 'three.jpg'),
    ]);
    await cards(page).nth(2).dragTo(cards(page).nth(0));
    expect(await cardNames(page)).toEqual(['three.jpg', 'one.png', 'two.png']);
  },
);

test('images picked on the home page arrive as pages', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('home-drop')).toHaveAttribute('data-live', 'true');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop any files here/ }).click();
  await (
    await chooser
  ).setFiles([
    fixture('images/no-exif.jpg', 'one.jpg', 'image/jpeg'),
    fixture('images/alpha.png', 'two.png', 'image/png'),
    fixture('intake/sample.pdf', 'three.pdf', 'application/pdf'),
  ]);
  await page
    .getByRole('list', { name: 'Suggested tools' })
    .getByRole('button')
    .filter({ hasText: 'Make a PDF' })
    .click();
  await expect(page).toHaveURL(/\/images-to-pdf$/);
  await expect(cards(page)).toHaveCount(2);
  expect(await cardNames(page)).toEqual(['one.jpg', 'two.png']);
});

test.describe('outside the US and Canada', () => {
  test.use({ locale: 'en-GB' });
  test('A4 is the default page size', async ({ page }) => {
    await open(page);
    await pick(page, [fixture('images/opaque.png')]);
    await expect(page.getByLabel('Page size')).toHaveText('A4');
  });
});

test('workspace has no serious accessibility issues', async ({ page }) => {
  await open(page);
  await pick(page, [fixture('images/opaque.png'), fixture('images/no-exif.jpg')]);
  const results = await new AxeBuilder({ page }).analyze();
  // The DropZone naming issue was fixed in P11b, so nothing is filtered.
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});
