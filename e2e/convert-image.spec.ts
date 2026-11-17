// Convert image and the format pages (P15): transparent PNG → JPG on the chosen background, → WebP
// keeps alpha, every input format to every output format, and each format page pre-rendered with
// its own title and target.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from './support/test';
import { unzipSync } from 'fflate';
import { formatPages } from '../src/tools/registry';

interface Upload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const fixture = (file: string, name = path.basename(file)): Upload => ({
  name,
  mimeType: '',
  buffer: readFileSync(path.resolve('tests/fixtures', file)),
});

/** Adds files through the drop zone's picker (retried until the page has hydrated). */
async function addFiles(page: Page, files: Upload[]) {
  const zone = page.getByRole('button', { name: /^Drop images here/ });
  await expect(async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 5_000 });
    await zone.click();
    await (await chooser).setFiles(files);
  }).toPass({ timeout: 40_000 });
}

async function bytesOf(download: Download): Promise<Buffer> {
  return readFileSync(await download.path());
}

/** Decodes an image in the page; returns its size and the RGBA of the given points. */
async function decode(page: Page, bytes: Uint8Array, points: Array<[number, number]> = []) {
  return page.evaluate(
    async ({ base64, points }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data]));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const pixels = points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
      return { width: bitmap.width, height: bitmap.height, pixels };
    },
    { base64: Buffer.from(bytes).toString('base64'), points },
  );
}

/** The real format of encoded bytes, from their signature. */
function sniff(bytes: Uint8Array): string {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (ascii(1, 4) === 'PNG') return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && /avi[fs]/.test(ascii(8, 12))) return 'avif';
  return 'unknown';
}

const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' } as const;
const LABEL = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF' } as const;
const saveAs = (page: Page) => page.getByRole('combobox', { name: 'Save as' });
const download = (page: Page) => page.getByRole('button', { name: 'Download', exact: true });

async function chooseFormat(page: Page, label: string) {
  await saveAs(page).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(saveAs(page)).toHaveText(label);
}

test('transparent PNG → JPG uses the chosen background; → WebP keeps the transparency', async ({
  page,
}) => {
  await page.goto('convert-image');
  // alpha.png, 90×60: transparent left third, 50 % blue middle, opaque orange right.
  await addFiles(page, [fixture('images/alpha.png')]);
  await expect(saveAs(page)).toHaveText('JPG');
  await page.getByRole('radio', { name: 'Black' }).click();
  await expect(download(page)).toBeDisabled();
  await expect(download(page)).toBeEnabled({ timeout: 30_000 });

  const [jpg] = await Promise.all([page.waitForEvent('download'), download(page).click()]);
  expect(jpg.suggestedFilename()).toBe('alpha.jpg');
  const jpgBytes = await bytesOf(jpg);
  expect(sniff(jpgBytes)).toBe('jpeg');
  const flat = await decode(page, jpgBytes, [
    [10, 30],
    [80, 30],
  ]);
  expect(flat).toMatchObject({ width: 90, height: 60 });
  const [left, right] = flat.pixels;
  expect(Math.max(left![0]!, left![1]!, left![2]!), 'transparent area is black').toBeLessThan(20);
  expect(right![0], 'opaque orange stays orange').toBeGreaterThan(200);

  await chooseFormat(page, 'WebP');
  await expect(page.getByText('PNG, WebP and AVIF keep transparent areas.')).toBeVisible();
  await expect(download(page)).toBeEnabled({ timeout: 30_000 });
  const [webp] = await Promise.all([page.waitForEvent('download'), download(page).click()]);
  expect(webp.suggestedFilename()).toBe('alpha.webp');
  const webpBytes = await bytesOf(webp);
  expect(sniff(webpBytes)).toBe('webp');
  const alpha = await decode(page, webpBytes, [
    [10, 30],
    [45, 30],
    [80, 30],
  ]);
  expect(alpha.pixels[0]![3], 'left third stays transparent').toBe(0);
  expect(alpha.pixels[1]![3], 'middle stays half transparent').toBeGreaterThan(90);
  expect(alpha.pixels[1]![3], 'middle stays half transparent').toBeLessThan(170);
  expect(alpha.pixels[2]![3], 'right third stays opaque').toBe(255);
});

test(
  'every input format converts to every output format',
  { tag: '@heavy' },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.endsWith('phone'), 'Format matrix: once per engine is enough');
    // 7 files × 4 formats: tagged @heavy, so it runs after the rest of the suite (playwright.config.ts).
    test.setTimeout(480_000);
    await page.goto('convert-image');
    const inputs = [
      fixture('images/no-exif.jpg', 'jpg-in.jpg'),
      fixture('images/opaque.png', 'png-in.png'),
      fixture('images/sample.webp', 'webp-in.webp'),
      fixture('images/sample.avif', 'avif-in.avif'),
      fixture('images/sample.gif', 'gif-in.gif'),
      fixture('images/sample.bmp', 'bmp-in.bmp'),
      fixture('images/iphone-7.heic', 'heic-in.heic'),
    ];
    await addFiles(page, inputs);
    const zipButton = page.getByRole('button', { name: `Download all ${inputs.length} as ZIP` });

    for (const format of ['jpeg', 'png', 'webp', 'avif'] as const) {
      if (format !== 'jpeg') {
        await chooseFormat(page, LABEL[format]);
        await expect(zipButton).toBeDisabled();
      }
      await expect(page.getByText(`${inputs.length} of ${inputs.length} ready`)).toBeVisible({
        timeout: 240_000,
      });
      await expect(zipButton).toBeEnabled();
      const [zip] = await Promise.all([page.waitForEvent('download'), zipButton.click()]);
      const entries = unzipSync(await bytesOf(zip));
      expect(Object.keys(entries), format).toEqual(
        inputs.map((f) => `${path.parse(f.name).name}.${EXT[format]}`),
      );
      for (const [name, bytes] of Object.entries(entries)) {
        expect(sniff(bytes), `${name} as ${format}`).toBe(format);
      }
    }
  },
);

test.describe('format pages', () => {
  const inputFor = {
    png: fixture('images/opaque.png', 'card.png'),
    jpeg: fixture('images/no-exif.jpg', 'card.jpg'),
    webp: fixture('images/sample.webp', 'card.webp'),
    avif: fixture('images/sample.avif', 'card.avif'),
  } as const;

  test('each format page is pre-rendered with its own title and heading', async ({ request }) => {
    for (const page of formatPages) {
      const response = await request.get(`./${page.id}`);
      expect(response.status(), page.id).toBe(200);
      const html = await response.text();
      expect(html, page.id).toContain(
        `<title>${page.title ?? `${page.name} — Snap Convert`}</title>`,
      );
      expect(html, page.id).toMatch(new RegExp(`<h1[^>]*>${page.name}</h1>`));
    }
  });

  for (const meta of formatPages) {
    test(`${meta.name} starts with ${LABEL[meta.to]} as the target`, async ({ page }) => {
      await page.goto(meta.id);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(meta.name);
      await addFiles(page, [inputFor[meta.from]]);
      await expect(saveAs(page)).toHaveText(LABEL[meta.to]);
      await expect(download(page)).toBeEnabled({ timeout: 30_000 });
      const [file] = await Promise.all([page.waitForEvent('download'), download(page).click()]);
      expect(file.suggestedFilename()).toBe(`card.${EXT[meta.to]}`);
      expect(sniff(await bytesOf(file))).toBe(meta.to);
    });
  }

  test('a format page keeps its own target; Convert image keeps its remembered one', async ({
    page,
  }) => {
    await page.goto('convert-image');
    await addFiles(page, [inputFor.png]);
    await chooseFormat(page, 'AVIF');

    await page.goto('png-to-jpg');
    await addFiles(page, [inputFor.png]);
    await expect(saveAs(page)).toHaveText('JPG');
    await chooseFormat(page, 'WebP');

    await page.goto('png-to-jpg');
    await addFiles(page, [inputFor.png]);
    await expect(saveAs(page)).toHaveText('JPG');

    await page.goto('convert-image');
    await addFiles(page, [inputFor.png]);
    await expect(saveAs(page)).toHaveText('AVIF');
  });
});
