// HEIC to JPG (P15): an iPhone photo becomes an upright JPG at its full size, with the location
// removed by default; other images are offered to Convert image.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

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
  const zone = page.getByRole('button', { name: /^Drop HEIC photos here/ });
  await expect(async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 1500 });
    await zone.click();
    await (await chooser).setFiles(files);
  }).toPass({ timeout: 20_000 });
}

/** Size of an image decoded by the browser (EXIF orientation applied, as any viewer would). */
async function decodedSize(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data]), { imageOrientation: 'from-image' });
    return { width: bitmap.width, height: bitmap.height };
  }, bytes.toString('base64'));
}

/** The photo details still in the file (EXIF), read the way photo apps read them. */
async function details(jpeg: Buffer): Promise<Record<string, unknown>> {
  // Node loads exifr's UMD build: everything is on the default export.
  const exifr = (await import('exifr')).default;
  const tags: unknown = await exifr.parse(jpeg, { gps: true, tiff: true, exif: true });
  return typeof tags === 'object' && tags !== null ? (tags as Record<string, unknown>) : {};
}

// GOVERNOR: Playwright's WebKit build for Windows has no OffscreenCanvas in workers ("Can't find
// variable: OffscreenCanvas"), so the image engine (src/engines/image/decode) can't decode there and
// every job fails. Safari has it (16.4+). Remove once the engine has a fallback or WebKit runs on CI.
const noEngineHere = (browserName: string) =>
  browserName === 'webkit' && process.platform === 'win32';
const NO_ENGINE = 'Playwright WebKit on Windows: no OffscreenCanvas in workers (image engine)';

test('an iPhone HEIC photo becomes an upright, full-size JPG without its location', async ({
  page,
  browserName,
}) => {
  test.fixme(noEngineHere(browserName), NO_ENGINE);
  test.setTimeout(120_000);
  await page.goto('heic-to-jpg');
  await expect(page.getByText(/iPhones save photos as HEIC/)).toBeVisible();
  await addFiles(page, [fixture('images/iphone-7.heic')]);

  const saveAs = page.getByRole('combobox', { name: 'Save as' });
  await expect(saveAs).toHaveText('JPG');
  await expect(page.getByRole('slider', { name: 'Quality' })).toHaveAttribute(
    'aria-valuenow',
    '90',
  );
  await expect(page.getByRole('radio', { name: 'Remove location only' })).toBeChecked();

  const download = page.getByRole('button', { name: 'Download', exact: true });
  await expect(download).toBeEnabled({ timeout: 90_000 });
  await expect(page.getByTestId('result-stat')).toContainText('4032×3024');
  await expect(page.getByTestId('result-notes')).toContainText('bigger than HEIC photos');
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  expect(file.suggestedFilename()).toBe('iphone-7.jpg');
  const bytes = readFileSync(await file.path());
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(await decodedSize(page, bytes)).toEqual({ width: 4032, height: 3024 });
  const tags = await details(bytes);
  expect(tags.Make, 'camera details kept').toBe('Apple');
  expect(tags.latitude, 'location removed').toBeUndefined();
  expect(tags.GPSLatitude, 'location removed').toBeUndefined();
  // The pixels are upright, so the file must not ask viewers to rotate them again.
  expect([undefined, 1, 'Horizontal (normal)']).toContain(tags.Orientation);

  await saveAs.click();
  await expect(page.getByRole('option')).toHaveText(['JPG', 'PNG']);
  await page.keyboard.press('Escape');
});

test('other images are offered to Convert image', async ({ page, browserName }) => {
  await page.goto('heic-to-jpg');
  await addFiles(page, [fixture('images/alpha.png'), fixture('images/no-exif.jpg')]);

  const notice = page.getByTestId('not-heic');
  await expect(notice).toContainText('2 files aren’t HEIC photos');
  await expect(page.getByRole('button', { name: /^Drop HEIC photos here/ })).toBeVisible();
  await notice.getByRole('button', { name: 'Open in Convert image' }).click();

  await expect(page).toHaveURL(/\/convert-image$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Convert image');
  const thumbs = page.getByRole('list', { name: 'Your images' }).getByRole('button', {
    name: /\.(png|jpg)$/,
  });
  await expect(thumbs).toHaveCount(2);
  if (noEngineHere(browserName)) return;
  await expect(page.getByText('2 of 2 ready')).toBeVisible({ timeout: 30_000 });
});
