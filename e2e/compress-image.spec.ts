// Compress image (P14): upload, presets, quality, target size, resize, many files + ZIP, phones.
// Every result is made by the real image worker from the production build.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from './support/test';
import { unzipSync } from 'fflate';

const SAMPLE = readFileSync(path.resolve('public/samples/compress-sample.jpg'));
const fixture = (file: string) => readFileSync(path.resolve('tests/fixtures', file));

/** The sample photo is 1280×889, 155 KB. */
const SAMPLE_SIZE = '1280×889';

const fresh = (page: Page) => page.locator('[data-testid="compare"][data-fresh]');
const compare = (page: Page) => page.getByTestId('compare');
const newSize = (page: Page) => page.getByTestId('new-size');
const qualitySlider = (page: Page) => page.getByRole('slider', { name: 'Quality' });
const sizeField = (page: Page) => page.getByRole('spinbutton', { name: 'Size' });
const alsoResize = (page: Page) => page.getByRole('checkbox', { name: /Also resize/ });
const downloadButton = (page: Page) => page.getByRole('button', { name: 'Download', exact: true });

/** "103 KB" → 103, "1.2 MB" → 1228.8, "830 B" → 0.81 (in KB). */
function kb(text: string): number {
  const match = /([\d.]+)\s*(B|KB|MB)/.exec(text);
  if (!match) throw new Error(`Not a size: ${text}`);
  const value = Number(match[1]);
  return match[2] === 'MB' ? value * 1024 : match[2] === 'B' ? value / 1024 : value;
}

/** Width and height from a JPEG's frame header. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1]!;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xc2) {
      return {
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!,
      };
    }
    i += 2 + length;
  }
  throw new Error('No JPEG frame header');
}

const contains = (bytes: Uint8Array, text: string) =>
  Buffer.from(bytes).includes(text, 0, 'latin1');

// Real encodes in the production worker; each waits up to a minute for its result.
test.describe.configure({ timeout: 90_000 });

async function open(page: Page) {
  await page.goto('compress-image');
  // The pre-rendered page takes files once its code has loaded and hydrated.
  await expect(page.getByTestId('compress-drop')).toHaveAttribute('data-live', 'true');
}

async function upload(
  page: Page,
  files: Array<{ name: string; buffer: Buffer; mimeType?: string }>,
) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop images here/ }).click();
  await (await chooser).setFiles(files.map((f) => ({ mimeType: 'image/jpeg', ...f })));
}

async function sample(page: Page) {
  await open(page);
  await page.getByRole('button', { name: 'Try with a sample photo' }).click();
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
}

async function savedDownload(page: Page, click: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await click();
  const download = await pending;
  const file = await download.path();
  return { name: download.suggestedFilename(), bytes: new Uint8Array(readFileSync(file)) };
}

test('the sample photo at default settings comes out smaller', async ({ page }) => {
  await sample(page);
  await expect(page.getByText('sample-photo.jpg')).toBeVisible();
  const original = kb(await page.getByRole('definition').first().innerText());
  const result = kb(await newSize(page).innerText());
  expect(result).toBeLessThan(original);
  await expect(page.getByTestId('saved')).toHaveText(/^−\d+%$/);
  await expect(page.getByTestId('result-dims')).toHaveText(SAMPLE_SIZE);
  // The SSIM debug line is for development only.
  await expect(page.getByTestId('debug-ssim')).toHaveCount(0);
  // Both sides of the slider show an image.
  await expect(compare(page).locator('img')).toHaveCount(2);
});

test('a downloaded photo is upright and has no location data', async ({ page }) => {
  await open(page);
  await upload(page, [{ name: 'sideways.jpg', buffer: fixture('images/orientation-6.jpg') }]);
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  const rotated = await savedDownload(page, () => downloadButton(page).click());
  expect(rotated.name).toBe('sideways-compressed.jpg');
  // Stored 64×96 with EXIF orientation 6; the download is the upright 96×64 picture, no EXIF.
  expect(jpegSize(rotated.bytes)).toEqual({ width: 96, height: 64 });
  expect(contains(rotated.bytes, 'Exif\0\0')).toBe(false);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add images' }).click();
  await (
    await chooser
  ).setFiles({ name: 'located.jpg', mimeType: 'image/jpeg', buffer: fixture('images/gps.jpg') });
  // The added file is selected.
  await expect(page.getByRole('button', { name: 'located.jpg', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('located.jpg', { exact: true })).toBeVisible();
  const located = await savedDownload(page, () => downloadButton(page).click());
  expect(located.name).toBe('located-compressed.jpg');
  expect(contains(located.bytes, 'GPS')).toBe(false);
  expect(contains(located.bytes, 'Exif\0\0')).toBe(false);
});

test('presets set size, format and quality; a manual change clears the chip', async ({ page }) => {
  await sample(page);
  const email = page.getByRole('button', { name: 'Email', exact: true });
  await email.click();
  await expect(email).toHaveAttribute('aria-pressed', 'true');
  await expect(alsoResize(page)).toBeChecked();
  await expect(sizeField(page)).toHaveValue('800');
  await expect(page.getByRole('combobox', { name: 'Save as' })).toHaveText('JPG');
  await expect(qualitySlider(page)).toHaveAttribute('aria-valuenow', '80');
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('result-dims')).toHaveText(/^800×55\d$/);

  const wordpress = page.getByRole('button', { name: 'WordPress', exact: true });
  await wordpress.click();
  await expect(wordpress).toHaveAttribute('aria-pressed', 'true');
  await expect(email).toHaveAttribute('aria-pressed', 'false');
  await expect(sizeField(page)).toHaveValue('2048');
  // 2048 px is bigger than the photo: it is never enlarged.
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('result-dims')).toHaveText(SAMPLE_SIZE);

  await qualitySlider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(qualitySlider(page)).toHaveAttribute('aria-valuenow', '79');
  await expect(wordpress).toHaveAttribute('aria-pressed', 'false');
});

test('lower quality makes a smaller file, and the preview never shows a stale result', async ({
  page,
}) => {
  await sample(page);
  const before = kb(await newSize(page).innerText());
  await qualitySlider(page).focus();
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await expect(qualitySlider(page)).toHaveAttribute('aria-valuenow', '60');
  // Straight after the change the old result is marked as updating, not shown as current.
  await expect(compare(page)).not.toHaveAttribute('data-fresh');
  await expect(newSize(page).getByRole('img', { name: 'Compressing…' })).toBeVisible();
  await expect(downloadButton(page)).toBeDisabled();
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  expect(kb(await newSize(page).innerText())).toBeLessThan(before);
  await expect(downloadButton(page)).toBeEnabled();
});

test("a target the photo can't reach says so and offers a working resize", async ({ page }) => {
  await sample(page);
  await page.getByRole('radio', { name: 'Target file size' }).click();
  const target = page.getByRole('spinbutton', { name: 'Make each file smaller than' });
  await target.fill('50');
  await target.press('Tab');
  const note = page.getByTestId('note-target-unreachable');
  await expect(note).toContainText(`Can't reach 50 KB at ${SAMPLE_SIZE}`, { timeout: 60_000 });

  const resize = note.getByRole('button', { name: /^Resize to \d+ px$/ });
  const px = Number(/\d+/.exec(await resize.innerText())?.[0]);
  expect(px).toBeGreaterThan(0);
  expect(px).toBeLessThan(1280);
  await resize.click();
  await expect(alsoResize(page)).toBeChecked();
  await expect(sizeField(page)).toHaveValue(String(px));
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('result-dims')).toHaveText(new RegExp(`^${px}×\\d+$`));
  await expect(note).toHaveCount(0);
  expect(kb(await newSize(page).innerText())).toBeLessThanOrEqual(50);
});

test('resizing keeps proportions and matches the planned size', async ({ page }) => {
  await sample(page);
  await alsoResize(page).check();
  await page.getByRole('combobox', { name: 'Resize by' }).click();
  await page.getByRole('option', { name: 'Max width' }).click();
  await sizeField(page).fill('640');
  await sizeField(page).press('Tab');
  // The planned size updates just after the field commits: wait for it, don't read it once.
  const planned = page.getByTestId('dims-preview').locator('strong');
  await expect(planned).toHaveText(/^640×44\d$/);
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('result-dims')).toHaveText(await planned.innerText());
});

test('20 photos download as a ZIP of 20 correctly named files', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Heavy batch: covered on desktop; the phone bar has its own test');
  test.setTimeout(180_000);
  await open(page);
  const names = Array.from({ length: 20 }, (_, i) => `photo-${String(i + 1).padStart(2, '0')}.jpg`);
  await upload(
    page,
    names.map((name) => ({ name, buffer: SAMPLE })),
  );
  await expect(
    page
      .getByRole('group', { name: 'Choose an image to preview' })
      .getByRole('button', { name: /^photo-/ }),
  ).toHaveCount(20);
  const zipButton = page.getByRole('button', { name: 'Download all 20 as ZIP' });
  await expect(zipButton).toBeEnabled({ timeout: 150_000 });
  const zip = await savedDownload(page, () => zipButton.click());
  expect(zip.name).toBe('snap-convert-compressed.zip');
  const entries = unzipSync(zip.bytes);
  expect(Object.keys(entries).sort()).toEqual(
    names.map((n) => n.replace('.jpg', '-compressed.jpg')),
  );
  for (const bytes of Object.values(entries)) {
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes.length).toBeLessThan(SAMPLE.length);
  }
});

test('phones get a fixed Download bar', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone layout');
  await open(page);
  await upload(page, [
    { name: 'one.jpg', buffer: SAMPLE },
    { name: 'two.jpg', buffer: fixture('images/no-exif.jpg') },
  ]);
  const bar = page.getByRole('group', { name: 'Actions' });
  await expect(bar).toHaveCSS('position', 'fixed');
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && Math.round(box.y + box.height)).toBe(viewport?.height);
  await expect(downloadButton(page)).toBeInViewport();
  await expect(bar.getByText('All (ZIP)')).toBeVisible();
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  await expect(bar.getByRole('button', { name: 'Download all 2 as ZIP' })).toBeEnabled({
    timeout: 60_000,
  });
  // The thumbnails switch the preview.
  await page.getByRole('button', { name: 'one.jpg' }).click();
  await expect(fresh(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('result-dims')).toHaveText(SAMPLE_SIZE);
});

test('a broken photo shows its error on the file, without breaking the page', async ({ page }) => {
  await open(page);
  // A JPEG start followed by nothing usable.
  const broken = Buffer.concat([fixture('images/no-exif.jpg').subarray(0, 120), Buffer.alloc(64)]);
  await upload(page, [{ name: 'broken.jpg', buffer: broken }]);
  await expect(newSize(page)).toHaveText('Failed', { timeout: 60_000 });
  await expect(page.getByRole('alert').filter({ hasText: /\S/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(downloadButton(page)).toBeDisabled();
});

test('images dropped on the home page arrive here (PDFs stay behind)', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('home-drop')).toHaveAttribute('data-live', 'true');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop any files here/ }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'one.jpg', mimeType: 'image/jpeg', buffer: fixture('images/no-exif.jpg') },
    { name: 'two.jpg', mimeType: 'image/jpeg', buffer: fixture('images/gps.jpg') },
    { name: 'doc.pdf', mimeType: 'application/pdf', buffer: fixture('intake/sample.pdf') },
  ]);
  await page
    .getByRole('list', { name: 'Suggested tools' })
    .getByRole('button')
    .filter({ hasText: 'Compress' })
    .click();
  await expect(page).toHaveURL(/\/compress-image$/);
  const thumbs = page
    .getByRole('group', { name: 'Choose an image to preview' })
    .getByRole('button');
  await expect(thumbs).toHaveCount(3); // two thumbnails and "Add images"
  await expect(page.getByRole('button', { name: 'one.jpg', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'two.jpg', exact: true })).toBeVisible();
});
