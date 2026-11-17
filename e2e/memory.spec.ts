// P24 memory and main-thread check: Bulk resizes 300 real photos on a phone-sized screen (and on
// desktop) without the tab crashing, no main-thread task takes over 200 ms while it runs, and every
// object URL the page made is released once the images are removed. Chromium only (long-task and
// heap APIs). Opt-in with the real-world run:
//   E2E_REAL=1 E2E_PORT=<port> pnpm e2e memory --project chromium-desktop --project chromium-phone
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './support/test';

test.skip(!process.env.E2E_REAL, 'opt-in: set E2E_REAL=1');
test.skip(({ browserName }) => browserName !== 'chromium', 'uses Chromium-only performance APIs');
test.describe.configure({ timeout: 600_000 });

const SAMPLE = readFileSync(path.resolve('public/samples/compress-sample.jpg'));
const PHOTOS = [
  'quality/photo-fine-detail.jpg',
  'quality/photo-night-noise.jpg',
  'quality/photo-portrait-exif-rotated.jpg',
].map((f) => readFileSync(path.resolve('tests/fixtures', f)));

interface Probe {
  live: number;
  made: number;
  longTasks: number[];
}

test('Bulk: 300 photos, no crash, no long main-thread task, object URLs released', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe = { live: 0, made: 0, longTasks: [] as number[] };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    const live = new Set<string>();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = create(obj);
      live.add(url);
      probe.made++;
      probe.live = live.size;
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      live.delete(url);
      probe.live = live.size;
      revoke(url);
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) probe.longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
  let crashed = false;
  page.on('crash', () => (crashed = true));

  // Over 50 MB in all, so Playwright needs them as files on disk.
  const dir = test.info().outputPath('photos');
  mkdirSync(dir, { recursive: true });
  const files = Array.from({ length: 300 }, (_, i) => {
    const file = path.join(dir, `photo-${String(i + 1).padStart(3, '0')}.jpg`);
    // Mostly the 1280 px sample; every 10th a 7–9 MP photo.
    writeFileSync(file, i % 10 === 9 ? PHOTOS[((i - 9) / 10) % 3]! : SAMPLE);
    return file;
  });
  await page.goto('bulk-resize');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bulk resize & compress');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop as many images as you like/ }).click();
  await (await chooser).setFiles(files);
  await expect(page.getByText('300 files')).toBeVisible({ timeout: 60_000 });

  const probe = () => page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);
  await page.evaluate(() => {
    (window as unknown as { __probe: Probe }).__probe.longTasks = [];
  });
  const started = Date.now();
  await page.getByRole('button', { name: 'Resize 300 images' }).click();
  await expect(page.getByTestId('bulk-summary')).toContainText('300 done', { timeout: 540_000 });
  const seconds = (Date.now() - started) / 1000;
  const during = await probe();
  const heap = await page.evaluate(
    () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
      0,
  );
  test
    .info()
    .annotations.push(
      { type: 'run', description: `300 photos in ${seconds.toFixed(1)} s` },
      {
        type: 'long tasks',
        description: `${during.longTasks.length}, longest ${Math.max(0, ...during.longTasks)} ms`,
      },
      { type: 'heap after run', description: `${(heap / 1048576).toFixed(0)} MB` },
      { type: 'object URLs', description: `made ${during.made}, live after run ${during.live}` },
    );
  expect(crashed).toBe(false);
  expect(Math.max(0, ...during.longTasks)).toBeLessThanOrEqual(200);

  // Removing the images releases every object URL made for them (thumbnails, results).
  await page.getByRole('button', { name: 'Remove all images' }).first().click();
  const confirm = page.getByRole('button', { name: /^(Remove|Clear)/ }).filter({ visible: true });
  if (await page.getByRole('alertdialog').or(page.getByRole('dialog')).isVisible()) {
    await confirm.last().click();
  }
  await expect(page.getByText('300 files')).toHaveCount(0);
  await expect.poll(async () => (await probe()).live, { timeout: 10_000 }).toBe(0);
  expect(crashed).toBe(false);
});
