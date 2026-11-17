// Optimize for web (P16): pick a destination, drop images, download small, sharp, private files.
// Every run goes through the real image worker; downloaded files are checked byte by byte.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';

interface Fixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

function fixture(file: string, name = path.basename(file), mimeType = 'image/jpeg'): Fixture {
  return { name, mimeType, buffer: readFileSync(path.resolve('tests/fixtures', file)) };
}

/** 4032×2268 photo with fine detail. */
const bigPhoto = (name = 'cat.jpg') => fixture('quality/photo-fine-detail.jpg', name);
/** 96×64 test card with a GPS block. */
const gpsPhoto = () => fixture('images/gps.jpg', 'tiny-gps.jpg');

const dropZone = (page: Page) =>
  page.getByRole('button', { name: /^Drop images for your website/ });
const rows = (page: Page) => page.getByTestId('file-row');
const summary = (page: Page) => page.getByTestId('run-summary');

async function pick(page: Page, files: Fixture[]) {
  const chooser = page.waitForEvent('filechooser');
  await dropZone(page).click();
  await (await chooser).setFiles(files);
}

async function bytesOf(download: Download): Promise<Buffer> {
  return readFileSync(await download.path());
}

interface JpegInfo {
  width: number;
  height: number;
  progressive: boolean;
  hasExif: boolean;
}

/** Walks the JPEG markers up to the first scan. */
function readJpeg(b: Buffer): JpegInfo {
  expect(b[0]).toBe(0xff);
  expect(b[1]).toBe(0xd8);
  const info: JpegInfo = { width: 0, height: 0, progressive: false, hasExif: false };
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xda) break; // start of scan
    const length = b.readUInt16BE(i + 2);
    if (marker === 0xe1 && b.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      info.hasExif = true;
    }
    if (marker >= 0xc0 && marker <= 0xc3) {
      info.height = b.readUInt16BE(i + 5);
      info.width = b.readUInt16BE(i + 7);
      info.progressive = marker === 0xc2;
    }
    i += 2 + length;
  }
  return info;
}

test.beforeEach(async ({ page }) => {
  await page.goto('optimize-for-web');
  await expect(page.getByRole('heading', { level: 1, name: 'Optimize for web' })).toBeVisible();
});

test('the destination and format are remembered', async ({ page }) => {
  await pick(page, [gpsPhoto()]);
  await page.getByRole('radio', { name: 'Email' }).click();
  await page.getByRole('radio', { name: 'WebP' }).click();
  await page.reload();
  await pick(page, [gpsPhoto()]);
  await expect(page.getByRole('radio', { name: 'Email' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'WebP' })).toHaveAttribute('aria-checked', 'true');
});

test('the small-image warning shows only for images below the destination size', async ({
  page,
}) => {
  await pick(page, [bigPhoto(), gpsPhoto()]);
  const [big, small] = [rows(page).nth(0), rows(page).nth(1)];
  await expect(big.getByTestId('file-dims')).toHaveText('4032×2268 → 1920×1080');
  await expect(big.getByTestId('small-warning')).toHaveCount(0);
  await expect(small.getByTestId('small-warning')).toHaveText(
    'This image is 96 px wide — it may look soft as a full-width image',
  );
  await page.getByRole('radio', { name: 'Thumbnail' }).click();
  await expect(big.getByTestId('file-dims')).toHaveText('4032×2268 → 400×225');
  await expect(small.getByTestId('small-warning')).toHaveText(
    'This image is 96 px wide — it may look soft as a thumbnail',
  );
});

test.describe('image runs', () => {
  test('one photo: resized for the web, progressive JPG, no metadata, checklist shown', async ({
    page,
  }) => {
    await pick(page, [bigPhoto()]);
    const row = rows(page).first();
    await expect(row).toHaveAttribute('data-status', 'done', { timeout: 60_000 });

    await expect(row.getByTestId('file-dims')).toHaveText('4032×2268 → 1920×1080');
    const checklist = row.getByRole('list', { name: 'What was done' }).getByRole('listitem');
    await expect(checklist).toHaveText([
      'Resized to 1920 px',
      'Location removed',
      /^\d+% smaller$/,
      'Looks the same',
    ]);
    await expect(row.getByTestId('small-warning')).toHaveCount(0);
    await expect(row.getByText('cat-web.jpg')).toBeVisible();

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('cat-web.jpg');
    const bytes = await bytesOf(download);
    expect(bytes.length).toBeLessThan(bigPhoto().buffer.length);
    expect(readJpeg(bytes)).toEqual({
      width: 1920,
      height: 1080,
      progressive: true,
      hasExif: false,
    });
  });

  test('location data is removed and small images get a warning', async ({ page }) => {
    expect(readJpeg(gpsPhoto().buffer).hasExif).toBe(true);
    await pick(page, [gpsPhoto()]);
    const row = rows(page).first();
    await expect(row).toHaveAttribute('data-status', 'done', { timeout: 60_000 });

    await expect(row.getByTestId('small-warning')).toHaveText(
      'This image is 96 px wide — it may look soft as a full-width image',
    );
    await expect(row.getByRole('list', { name: 'What was done' })).toContainText(
      'Kept at 96 px (not enlarged)',
    );

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const bytes = await bytesOf(await downloading);
    const info = readJpeg(bytes);
    expect(info.hasExif).toBe(false);
    expect([info.width, info.height]).toEqual([96, 64]);
    expect(bytes.includes(Buffer.from('GPS', 'latin1'))).toBe(false);
  });

  test('each destination gives its documented size, and WebP its own extension', async ({
    page,
  }) => {
    await pick(page, [bigPhoto()]);
    const row = rows(page).first();
    const expected = [
      ['Website (general)', '1920 px · JPG', '1920×1080'],
      ['WordPress', '2048 px · JPG', '2048×1152'],
      ['Shopify', '2048 px · JPG', '2048×1152'],
      ['Blog hero', '1600 px · JPG', '1600×900'],
      ['Email', '800 px · JPG', '800×450'],
      ['Thumbnail', '400 px · JPG', '400×225'],
    ] as const;

    for (const [name, spec, size] of expected) {
      const card = page.getByRole('radio', { name });
      await expect(card).toContainText(spec);
      await card.click();
      await expect(card).toHaveAttribute('aria-checked', 'true');
      await expect(row).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
      await expect(row.getByTestId('file-dims')).toHaveText(`4032×2268 → ${size}`);
      await expect(row.getByRole('list', { name: 'What was done' })).toContainText(
        'Looks the same',
      );
      // Small-image warning only for images below the destination's recommended size.
      await expect(row.getByTestId('small-warning')).toHaveCount(0);
    }

    await page.getByRole('radio', { name: 'WebP' }).click();
    await expect(page.getByRole('radio', { name: 'Thumbnail' })).toContainText('400 px · WebP');
    await expect(row).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
    await expect(row.getByText('cat-web.webp')).toBeVisible();

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const bytes = await bytesOf(await downloading);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP');
  });

  test('50 images: time left while running, then one ZIP with every file', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes('phone'), 'Heavy run: desktop projects only');
    test.setTimeout(240_000);
    const files = Array.from({ length: 50 }, (_, i) => bigPhoto(`photo-${i + 1}.jpg`));
    await pick(page, files);

    await expect(page.getByTestId('files-heading')).toHaveText(/^50 images · /);
    await expect(summary(page).getByTestId('time-left')).toHaveText(/^about \d+ (s|min) left$/, {
      timeout: 60_000,
    });

    await expect(summary(page)).toContainText('50 done', { timeout: 200_000 });
    await expect(page.locator('[data-testid="file-row"][data-status="done"]')).toHaveCount(50);

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download all 50 as ZIP' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('optimized-for-web.zip');

    const zip = await bytesOf(download);
    // End of central directory record: total number of entries at offset 10.
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(0);
    expect(zip.readUInt16LE(eocd + 10)).toBe(50);
    expect(zip.includes(Buffer.from('photo-1-web.jpg'))).toBe(true);
    expect(zip.includes(Buffer.from('photo-50-web.jpg'))).toBe(true);
  });
});
