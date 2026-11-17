// Bulk resize & compress (P17): a 50-file run through the real image workers, failure + retry,
// ZIP contents, stale results after a settings change, the long-list window and the leave warning.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

interface Fixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const read = (file: string) => readFileSync(path.resolve('tests/fixtures', file));
const as = (file: string, name: string, mimeType = ''): Fixture => ({
  name,
  mimeType,
  buffer: read(file),
});

/** Looks like a JPEG (right first bytes) but can't be decoded. */
const corrupt = (name = 'corrupt-download.jpg'): Fixture => {
  const buffer = Buffer.alloc(8 * 1024, 0x5a);
  buffer.set([0xff, 0xd8, 0xff, 0xe0]);
  return { name, mimeType: 'image/jpeg', buffer };
};

/** 50 mixed images: big photos, a screenshot, tiny and rotated ones, WebP, GIF, BMP, HEIC, PNG. */
function fiftyFiles(): Fixture[] {
  const plan: Array<[file: string, count: number, base: string]> = [
    ['quality/photo-product-on-white.jpg', 10, 'product'],
    ['quality/photo-fine-detail.jpg', 4, 'detail'],
    ['quality/text-screenshot.png', 4, 'screen'],
    ['images/orientation-6.jpg', 8, 'rotated'],
    ['images/no-exif.jpg', 9, 'tiny'],
    ['images/sample.webp', 4, 'web'],
    ['images/sample.gif', 3, 'anim'],
    ['images/sample.bmp', 3, 'bitmap'],
    ['images/iphone-7.heic', 2, 'iphone'],
    ['images/alpha.png', 2, 'alpha'],
  ];
  const out: Fixture[] = [];
  for (const [file, count, base] of plan) {
    const ext = path.extname(file);
    for (let i = 1; i <= count; i++) out.push(as(file, `${base}-${i}${ext}`));
  }
  // Same output name as tiny-1.jpg ("tiny-1-96w.jpg"): the ZIP must still have unique names.
  out.push(as('images/no-exif.jpg', 'tiny-1.jpeg'));
  return out;
}

const listRows = (page: Page) =>
  page.getByRole('list', { name: 'Images to resize' }).getByRole('listitem');
const summary = (page: Page) => page.getByTestId('bulk-summary');
const runButton = (page: Page) => page.getByRole('button', { name: /^Resize \d+ images?$/ });

async function addFiles(page: Page, files: Fixture[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop as many images as you like/ }).click();
  await (await chooser).setFiles(files);
  await expect(listRows(page).first()).toBeVisible({ timeout: 20_000 });
}

async function downloadZip(page: Page): Promise<Record<string, Uint8Array>> {
  const download = page.waitForEvent('download');
  // The summary's button on wide screens, the fixed action bar's on phones.
  await page
    .getByRole('button', { name: 'Download ZIP' })
    .filter({ visible: true })
    .first()
    .click();
  const file = await (await download).path();
  return unzipSync(new Uint8Array(readFileSync(file)));
}

test.beforeEach(async ({ page }) => {
  await page.goto('bulk-resize');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bulk resize & compress');
});

test('50 mixed images resize into one ZIP with pattern names', async ({ page }) => {
  test.slow();
  const files = fiftyFiles();
  await addFiles(page, files);
  await expect(listRows(page)).toHaveCount(files.length);
  await expect(page.getByText(`${files.length} files`)).toBeVisible();

  // Planned sizes before the run, from the sizing rule.
  const detail = listRows(page).filter({ hasText: 'detail-1.jpg' });
  await expect(detail).toContainText('4032×2268 → 1920×1080');
  await expect(listRows(page).filter({ hasText: 'tiny-1.jpg' })).toContainText('not enlarged');
  await expect(summary(page)).toContainText(/Estimated: .+ → about .+/);

  await runButton(page).click();
  const phone = test.info().project.name.includes('phone');
  // Phones run at most 2 images at a time.
  const workers = phone ? '[12]' : '\\d';
  await expect(summary(page)).toContainText(
    new RegExp(
      `Processing ${workers} at a time… \\d+/50 · (estimating time…|about \\d+ (s|min) left)`,
    ),
  );
  if (phone) {
    for (let i = 0; i < 5; i++) {
      expect(await page.locator('[data-status="working"]').count()).toBeLessThanOrEqual(2);
      await page.waitForTimeout(150);
    }
  }

  await expect(summary(page)).toContainText(`${files.length} done`, { timeout: 120_000 });
  await expect(summary(page)).toContainText(/ → /);
  await expect(page.locator('[data-status="failed"]')).toHaveCount(0);
  // Done rows show the new name and the new size.
  await expect(listRows(page).filter({ hasText: 'detail-1-1920w.jpg' })).toContainText(
    '4032×2268 → 1920×1080',
  );

  const zip = await downloadZip(page);
  const names = Object.keys(zip);
  expect(names).toHaveLength(files.length);
  expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(files.length);
  for (const name of names) expect(name).toMatch(/^[a-z]+(-\d+)?-\d+w( \(\d+\))?\.jpg$/);
  expect(names).toContain('detail-1-1920w.jpg');
  expect(names).toContain('product-1-1280w.jpg');

  expect(names).toContain('tiny-1-96w.jpg');
  expect(names).toContain('tiny-1-96w (2).jpg');
  // Every entry is a real JPEG.
  for (const bytes of Object.values(zip)) expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
});

test('a broken file fails with a reason; Retry runs a stopped good file again', async ({
  page,
}) => {
  test.slow();
  const photos = Array.from({ length: 6 }, (_, i) =>
    as('quality/photo-fine-detail.jpg', `photo-${i + 1}.jpg`),
  );
  await addFiles(page, [corrupt(), ...photos]);
  await runButton(page).click();

  // Stop part-way: unfinished files are cancelled and can be retried one by one.
  await expect(summary(page)).toContainText('Processing');
  await summary(page).getByRole('button', { name: 'Stop resizing' }).click();
  const broken = listRows(page).filter({ hasText: 'corrupt-download.jpg' });
  await expect(summary(page)).not.toContainText('Processing');

  const retryGood = page
    .locator('[data-status="cancelled"]')
    .getByRole('button', { name: /^Retry photo-/ });
  test.skip((await retryGood.count()) === 0, 'Everything finished before Stop: nothing to retry');
  const label = (await retryGood.first().getAttribute('aria-label')) ?? '';
  const stem = label.replace(/^Retry /, '').replace(/\.jpg$/, ''); // e.g. photo-3
  await retryGood.first().click();
  const row = page.locator('[data-status]').filter({ hasText: `${stem}-1920w.jpg` });
  await expect(row).toHaveAttribute('data-status', 'done', { timeout: 60_000 });

  // Run the rest, including the broken file.
  if ((await runButton(page).count()) > 0) await runButton(page).click();
  await expect(summary(page)).toContainText(/\d+ done · 1 failed/, { timeout: 90_000 });
  await expect(broken.getByTestId('row-error')).toHaveText(
    "This file isn't an image Snap Convert can read",
  );
  await expect(page.locator('[data-status="done"]')).toHaveCount(photos.length);

  // Retry on the broken file fails again, with the same reason.
  await broken.getByRole('button', { name: 'Retry corrupt-download.jpg' }).click();
  await expect(summary(page)).toContainText(/6 done · 1 failed/, { timeout: 30_000 });
  await expect(broken.getByTestId('row-error')).toBeVisible();

  // The ZIP has only the finished files.
  const zip = await downloadZip(page);
  expect(Object.keys(zip).sort()).toEqual(
    photos.map((p) => p.name.replace('.jpg', '-1920w.jpg')).sort(),
  );
});

test('changing settings after a run marks results stale and re-enables Run', async ({ page }) => {
  await addFiles(page, [
    as('images/no-exif.jpg', 'a.jpg'),
    as('quality/photo-product-on-white.jpg', 'b.jpg'),
  ]);
  await runButton(page).click();
  await expect(summary(page)).toContainText('2 done', { timeout: 60_000 });
  await expect(
    page.getByRole('button', { name: 'Download ZIP' }).filter({ visible: true }).first(),
  ).toBeEnabled();

  // A new size makes the results stale.
  await page.getByRole('spinbutton', { name: 'Size' }).fill('800');
  await expect(summary(page)).toContainText('Settings changed — resize again to apply them.');
  await expect(runButton(page)).toHaveText('Resize 2 images');
  await expect(listRows(page).filter({ hasText: 'b.jpg' })).toContainText('1280×889 → 800×556');

  // Going back to the old settings brings the results back.
  await page.getByRole('spinbutton', { name: 'Size' }).fill('1920');
  await expect(summary(page)).toContainText('2 done');

  // The file-name pattern is applied on export, so it never makes results stale.
  await page.getByRole('textbox', { name: 'File names' }).fill('{n}-{name}');
  await expect(summary(page)).toContainText('2 done');
  const zip = await downloadZip(page);
  expect(Object.keys(zip).sort()).toEqual(['1-a.jpg', '2-b.jpg']);
});

test('12 sample files are made on the device', async ({ page }) => {
  await page.getByRole('button', { name: 'Try with 12 sample files' }).click();
  await expect(listRows(page)).toHaveCount(12);
  await expect(listRows(page).filter({ hasText: 'panorama-beach.jpg' })).toContainText(
    '4800×1200 → 1920×480',
  );
  await expect(listRows(page).filter({ hasText: 'thumb-small.jpg' })).toContainText('not enlarged');
});

test('long lists only render the rows near the screen', async ({ page }) => {
  const files = Array.from({ length: 250 }, (_, i) =>
    as('images/no-exif.jpg', `img-${String(i + 1).padStart(3, '0')}.jpg`),
  );
  await addFiles(page, files);
  await expect(page.getByText('250 files')).toBeVisible();
  const list = page.getByRole('list', { name: 'Images to resize' });
  await expect(list).toHaveAttribute('data-windowed', 'true');
  expect(await listRows(page).count()).toBeLessThan(80);
  await expect(listRows(page).first()).toHaveAttribute('aria-setsize', '250');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(listRows(page).filter({ hasText: 'img-250.jpg' })).toBeVisible();
  expect(await listRows(page).count()).toBeLessThan(80);
});

test('leaving with results that were not downloaded asks first', async ({ page }) => {
  await addFiles(page, [as('images/no-exif.jpg', 'a.jpg')]);
  await runButton(page).click();
  await expect(summary(page)).toContainText('1 done', { timeout: 60_000 });

  await page.getByRole('link', { name: 'All tools' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Leave this page?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/bulk-resize$/);

  // Once downloaded, leaving is free.
  await downloadZip(page);
  await page.getByRole('link', { name: 'All tools' }).first().click();
  await expect(page).not.toHaveURL(/\/bulk-resize$/);
});
