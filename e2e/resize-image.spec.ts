// Resize image (P15): sizes from the sizing rule, never enlarged by default, Exact size Fit pads and
// Fill crops — checked on the decoded output pixels, so a stretched image can't pass — and a bulk
// run of 30 mixed files downloaded as one ZIP with unique pattern names.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

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

/** Vertical stripes (one colour each, equal widths) drawn in the page and saved as PNG. */
async function stripesPng(
  page: Page,
  name: string,
  width: number,
  height: number,
  colours: string[],
): Promise<Upload> {
  const base64 = await page.evaluate(
    ({ width, height, colours }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      const w = width / colours.length;
      colours.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(Math.round(i * w), 0, Math.ceil(w), height);
      });
      return canvas.toDataURL('image/png').split(',')[1]!;
    },
    { width, height, colours },
  );
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

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
async function decode(page: Page, bytes: Buffer, points: Array<[number, number]> = []) {
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
    { base64: bytes.toString('base64'), points },
  );
}

/** PNG size from its IHDR chunk. */
function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function expectColour(actual: number[] | undefined, rgb: [number, number, number], label: string) {
  expect(actual, label).toBeDefined();
  const [r, g, b] = actual!;
  expect(Math.abs(r! - rgb[0]), `${label} red`).toBeLessThan(24);
  expect(Math.abs(g! - rgb[1]), `${label} green`).toBeLessThan(24);
  expect(Math.abs(b! - rgb[2]), `${label} blue`).toBeLessThan(24);
}

const dims = (page: Page) => page.getByTestId('dims-preview');
const resultStat = (page: Page) => page.getByTestId('result-stat');
const thumb = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Your images' }).getByRole('button', { name });

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function setNumber(page: Page, label: string, value: number) {
  const field = page.getByRole('spinbutton', { name: label, exact: true });
  await field.fill(String(value));
  await field.press('Enter');
}

// GOVERNOR: Playwright's WebKit build for Windows has no OffscreenCanvas in workers ("Can't find
// variable: OffscreenCanvas"), so the image engine (src/engines/image/decode) can't decode there and
// every job fails. Safari has it (16.4+). Remove once the engine has a fallback or WebKit runs on CI.
const noEngineHere = (browserName: string) =>
  browserName === 'webkit' && process.platform === 'win32';
const NO_ENGINE = 'Playwright WebKit on Windows: no OffscreenCanvas in workers (image engine)';

test.beforeEach(async ({ page, browserName }) => {
  test.fixme(noEngineHere(browserName), NO_ENGINE);
  await page.goto('resize-image');
});

test('resizes by longest side with proportions kept, and never enlarges', async ({ page }) => {
  const files = [
    await stripesPng(page, 'landscape.png', 2000, 1500, ['#ff0000', '#0000ff']),
    await stripesPng(page, 'portrait.png', 1500, 2000, ['#ff0000', '#0000ff']),
    await stripesPng(page, 'small.png', 800, 600, ['#00ff00']),
  ];
  await addFiles(page, files);
  await setNumber(page, 'Size', 1000);

  await thumb(page, 'landscape.png').click();
  await expect(dims(page)).toContainText('2000×1500→1000×750');
  await expect(resultStat(page)).toContainText('1000×750');

  await thumb(page, 'portrait.png').click();
  await expect(dims(page)).toContainText('1500×2000→750×1000');
  await expect(resultStat(page)).toContainText('750×1000');

  await setNumber(page, 'Size', 1920);
  await thumb(page, 'small.png').click();
  await expect(dims(page)).toContainText('800×600→800×600');
  await expect(dims(page)).toContainText('Already smaller · not enlarged');
  await expect(resultStat(page)).toContainText('800×600');
  await expect(page.getByTestId('result-notes')).toContainText('not enlarged');

  await setNumber(page, 'Size', 1000);
  await expect(page.getByText('3 of 3 ready')).toBeVisible();
  const zipButton = page.getByRole('button', { name: /^(Download all 3 as ZIP|All)/ });
  await expect(zipButton).toBeEnabled({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), zipButton.click()]);
  expect(download.suggestedFilename()).toBe('snap-convert-resize-image.zip');
  const entries = unzipSync(await bytesOf(download));
  expect(Object.keys(entries)).toEqual([
    'landscape-1000x750.png',
    'portrait-750x1000.png',
    'small-800x600.png',
  ]);
  expect(pngSize(entries['landscape-1000x750.png']!)).toEqual({ width: 1000, height: 750 });
  expect(pngSize(entries['portrait-750x1000.png']!)).toEqual({ width: 750, height: 1000 });
  expect(pngSize(entries['small-800x600.png']!)).toEqual({ width: 800, height: 600 });
});

test('Exact 1080×1080 pads a panorama with Fit and crops it with Fill — never stretched', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // 3:1 panorama: red | green | blue, 1200 px each.
  await addFiles(page, [
    await stripesPng(page, 'pano.png', 3600, 1200, ['#ff0000', '#00ff00', '#0000ff']),
  ]);
  await choose(page, 'Resize by', 'Exact size (fit or fill)');
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toHaveValue('1080');
  await expect(page.getByRole('spinbutton', { name: 'Height' })).toHaveValue('1080');
  await page.getByRole('radio', { name: 'Black' }).click();
  const download = page.getByRole('button', { name: 'Download', exact: true });
  await expect(download).toBeDisabled();

  // Fit: the whole panorama at 1080×360, centred, black above and below.
  await expect(dims(page)).toContainText('3600×1200→1080×1080');
  await expect(dims(page)).toContainText('padded');
  await expect(resultStat(page)).toContainText('1080×1080', { timeout: 30_000 });
  await expect(download).toBeEnabled();
  const [fitFile] = await Promise.all([page.waitForEvent('download'), download.click()]);
  expect(fitFile.suggestedFilename()).toBe('pano-1080x1080.png');
  const fit = await decode(page, await bytesOf(fitFile), [
    [540, 100], // padding above
    [540, 980], // padding below
    [540, 352], // just above the image (image rows 360–719)
    [540, 727], // just below
    [180, 540], // left third: red
    [540, 368], // centre, near the top edge: green
    [540, 540], // centre: green
    [900, 540], // right third: blue
    [900, 712],
  ]);
  expect(fit).toMatchObject({ width: 1080, height: 1080 });
  const [above, below, edgeTop, edgeBottom, red, greenTop, green, blue, blueBottom] = fit.pixels;
  expectColour(above, [0, 0, 0], 'padding above');
  expectColour(below, [0, 0, 0], 'padding below');
  expectColour(edgeTop, [0, 0, 0], 'row 352');
  expectColour(edgeBottom, [0, 0, 0], 'row 727');
  expectColour(red, [255, 0, 0], 'left third');
  expectColour(greenTop, [0, 255, 0], 'row 368');
  expectColour(green, [0, 255, 0], 'centre');
  expectColour(blue, [0, 0, 255], 'right third');
  expectColour(blueBottom, [0, 0, 255], 'row 712');
  await expect(page.getByTestId('result-notes')).toContainText('Padded to the exact size');

  // Fill: covers the box and keeps the middle (green) third; edges cropped, not squashed.
  await page.getByRole('radio', { name: /^Fill/ }).click();
  await expect(download).toBeDisabled(); // re-running with the new settings
  await expect(dims(page)).toContainText('cropped');
  await expect(page.getByRole('radiogroup', { name: 'Part of the image to keep' })).toBeVisible();
  await expect(page.getByTestId('result-notes')).toContainText('Edges trimmed', {
    timeout: 30_000,
  });
  await expect(download).toBeEnabled();
  const [fillFile] = await Promise.all([page.waitForEvent('download'), download.click()]);
  const fill = await decode(page, await bytesOf(fillFile), [
    [5, 540],
    [1074, 540],
    [540, 5],
    [540, 1074],
    [540, 540],
  ]);
  expect(fill).toMatchObject({ width: 1080, height: 1080 });
  for (const [i, pixel] of fill.pixels.entries()) expectColour(pixel, [0, 255, 0], `fill ${i}`);

  // Keeping the left part instead shows red on the left edge, still green further in.
  await page.getByRole('radio', { name: 'Left', exact: true }).click();
  await expect(download).toBeDisabled();
  await expect(page.getByTestId('result-notes')).toContainText('Edges trimmed', {
    timeout: 30_000,
  });
  await expect(download).toBeEnabled();
  const [leftFile] = await Promise.all([page.waitForEvent('download'), download.click()]);
  const left = await decode(page, await bytesOf(leftFile), [
    [5, 540],
    [1074, 540],
  ]);
  // Fill scale 0.9: source x 0–1200 (red) lands on 0–1080, so the whole box is red.
  expectColour(left.pixels[0], [255, 0, 0], 'left edge');
  expectColour(left.pixels[1], [255, 0, 0], 'right edge');
});

test('30 mixed files → one ZIP with pattern names, all unique', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.endsWith('phone'), 'Bulk run: once per engine is enough');
  test.setTimeout(120_000);
  const pool = [
    'images/no-exif.jpg',
    'images/alpha.png',
    'images/sample.webp',
    'images/sample.avif',
    'images/sample.gif',
    'images/sample.bmp',
  ];
  const files: Upload[] = [
    // Same output names (case ignored) → " (2)".
    fixture('images/no-exif.jpg', 'a.jpg'),
    fixture('images/gps.jpg', 'a.jpg'),
    fixture('images/orientation-5.jpg', 'b.jpg'),
    fixture('images/orientation-6.jpg', 'B.jpg'),
    fixture('images/alpha.png', 'c.png'),
    fixture('images/opaque.png', 'c.png'),
    fixture('images/sample.webp', 'd.webp'),
    fixture('images/sample.avif', 'd.avif'),
    fixture('images/sample.gif', 'e.gif'),
    fixture('images/sample.bmp', 'e.bmp'),
    ...Array.from({ length: 8 }, (_, i) =>
      fixture(`images/orientation-${i + 1}.jpg`, `o${i + 1}.jpg`),
    ),
    ...Array.from({ length: 12 }, (_, i) => {
      const file = pool[i % pool.length]!;
      return fixture(file, `m${i}${path.extname(file)}`);
    }),
  ];
  expect(files).toHaveLength(30);
  await addFiles(page, files);

  await expect(page.getByText('30 of 30 ready')).toBeVisible({ timeout: 90_000 });
  const zipButton = page.getByRole('button', { name: 'Download all 30 as ZIP' });
  await expect(zipButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), zipButton.click()]);
  const names = Object.keys(unzipSync(await bytesOf(download)));

  expect(names).toHaveLength(30);
  expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(30);
  expect(names.slice(0, 10)).toEqual([
    'a-96x64.jpg',
    'a-96x64 (2).jpg',
    'b-96x64.jpg',
    'B-96x64 (2).jpg',
    'c-90x60.png',
    'c-90x60 (2).png',
    'd-80x60.webp',
    'd-80x60.avif',
    'e-40x30.jpg', // GIF and BMP can't be saved as such: JPG
    'e-50x30.jpg',
  ]);
  // EXIF orientation is applied before sizing: every test card comes out 96×64.
  expect(names.slice(10, 18)).toEqual(Array.from({ length: 8 }, (_, i) => `o${i + 1}-96x64.jpg`));
  for (const name of names)
    expect(name).toMatch(/^[\w ()-]+-\d+x\d+(?: \(\d+\))?\.(jpg|png|webp|avif)$/);
});
