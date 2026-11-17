// P24 keyboard-only walkthroughs: Compress, Bulk and Merge can be used start to finish with Tab and
// Enter alone (open the picker, run, download), and every control that takes focus on the way
// shows a visible focus indicator.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from './support/test';

test.skip(({ isMobile }) => isMobile, 'keyboard walkthroughs are for desktop layouts');
test.describe.configure({ timeout: 120_000 });

const fixture = (file: string, mimeType: string) => ({
  name: path.basename(file),
  mimeType,
  buffer: readFileSync(path.resolve('tests/fixtures', file)),
});

interface Focused {
  name: string;
  visible: boolean;
}

/** Presses Tab until the focused control's name matches, checking each stop's focus ring. */
async function tabTo(page: Page, name: RegExp, max = 120): Promise<void> {
  const unmarked: string[] = [];
  for (let i = 0; i < max; i++) {
    // The app may already have moved focus there (e.g. to the result after a run).
    if (i > 0 || !(await page.evaluate(() => document.activeElement !== document.body))) {
      await page.keyboard.press('Tab');
    }
    const focused = await page.evaluate((): Focused => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { name: '', visible: true };
      const label =
        el.getAttribute('aria-label') ??
        (el.getAttribute('aria-labelledby')
          ? document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent
          : null) ??
        el.textContent ??
        '';
      const own = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      const ring = (s: CSSStyleDeclaration) =>
        (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
        (s.boxShadow !== 'none' && s.boxShadow !== '');
      return { name: label.replace(/\s+/g, ' ').trim(), visible: ring(own) || ring(after) };
    });
    if (!focused.visible) unmarked.push(focused.name);
    if (name.test(focused.name)) {
      expect(unmarked, 'focused controls without a visible focus ring').toEqual([]);
      return;
    }
  }
  throw new Error(`Tab never reached ${name}`);
}

async function pickWithEnter(page: Page, zone: RegExp, files: ReturnType<typeof fixture>[]) {
  // Listen first: Playwright turns on file-chooser interception asynchronously, and a key press is
  // faster than a mouse click's actionability checks.
  const chooser = page.waitForEvent('filechooser');
  await tabTo(page, zone);
  await page.keyboard.press('Enter');
  await (await chooser).setFiles(files);
}

async function downloadWithEnter(page: Page, name: RegExp) {
  await tabTo(page, name);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  return download;
}

test('Compress image by keyboard', async ({ page }) => {
  await page.goto('compress-image');
  await expect(page.getByTestId('compress-drop')).toHaveAttribute('data-live', 'true');
  await pickWithEnter(page, /^Drop images here/, [
    fixture('quality/photo-product-on-white.jpg', 'image/jpeg'),
  ]);
  await expect(page.locator('[data-testid="compare"][data-fresh]')).toBeVisible({
    timeout: 60_000,
  });
  const file = await downloadWithEnter(page, /^Download$/);
  expect(file.suggestedFilename()).toMatch(/\.jpg$/);
});

test('Bulk resize by keyboard', async ({ page }) => {
  await page.goto('bulk-resize');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bulk resize & compress');
  await pickWithEnter(page, /^Drop as many images as you like/, [
    fixture('images/no-exif.jpg', 'image/jpeg'),
    fixture('images/sample.webp', 'image/webp'),
  ]);
  await tabTo(page, /^Resize 2 images$/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('bulk-summary')).toContainText('2 done', { timeout: 60_000 });
  const file = await downloadWithEnter(page, /^Download ZIP$/);
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
});

test('Merge PDF by keyboard', async ({ page }) => {
  await page.goto('merge-pdf');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Merge PDF');
  await pickWithEnter(page, /^Drop PDF files here/, [
    fixture('pdf/a4-3-pages.pdf', 'application/pdf'),
    fixture('pdf/ten-pages.pdf', 'application/pdf'),
  ]);
  await tabTo(page, /^Merge 2 PDFs$/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible({ timeout: 30_000 });
  const file = await downloadWithEnter(page, /^Download PDF$/);
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
});
