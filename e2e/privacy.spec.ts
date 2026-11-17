// Credits, privacy page and cookie-free counting (P23), against the production build.
// The e2e build has no VITE_UMAMI_* settings, so counting is off: no analytics request may be sent.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousA11yIssues(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

test.describe('credits', () => {
  test('lists libraries, codecs, fonts, the sample photo and the AGPL notice', async ({ page }) => {
    await page.goto('credits');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open-source credits');

    const libraries = page.getByRole('table', { name: 'Libraries' });
    for (const [name, license] of [
      ['react', 'MIT'],
      ['pdfjs-dist', 'Apache-2.0'],
      ['libheif-js', 'LGPL-3.0'],
      ['lucide-react', 'ISC'],
      ['tslib', '0BSD'],
    ] as const) {
      const row = libraries
        .getByRole('row')
        .filter({ has: page.getByRole('link', { name: `${name} on npm`, exact: true }) });
      await expect(row.first()).toContainText(license);
    }
    for (const codec of [
      'MozJPEG',
      'libwebp',
      'libavif',
      'Oxipng',
      'libheif',
      'OpenJPEG',
      'JBIG2',
    ]) {
      await expect(page.getByText(codec, { exact: false }).first()).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Geist Mono' })).toBeVisible();
    await expect(page.getByText(/Petr Kratochvil.*CC0 1\.0/)).toBeVisible();
    await expect(page.getByText(/GNU Affero General Public License/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Source code' }).first()).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\//,
    );
  });

  test('links to every license text in a plain-text file', async ({ page, request }) => {
    await page.goto('credits');
    const href = await page.getByTestId('licenses-file').getAttribute('href');
    expect(href).toBe('/snap-convert/third-party-licenses.txt');
    const response = await request.get(href!);
    expect(response.status()).toBe(200);
    const txt = await response.text();
    expect(txt).toContain('Permission is hereby granted'); // MIT
    expect(txt).toContain('Apache License');
    expect(txt).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
    expect(txt).toContain('SIL Open Font License');
  });

  test('opens from the footer with client-side navigation', async ({ page }) => {
    await page.goto('privacy');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Open-source credits' }).click();
    await expect(page).toHaveURL(/\/snap-convert\/credits$/);
    await expect(page.getByRole('table', { name: 'Libraries' })).toBeVisible();
  });

  test('has no serious accessibility issues', async ({ page }) => {
    await page.goto('credits');
    await expectNoSeriousA11yIssues(page);
  });
});

test.describe('privacy', () => {
  test('explains the privacy promise and says counting is off in this build', async ({ page }) => {
    await page.goto('privacy');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');
    for (const heading of [
      'Your files stay on your device',
      'What we count',
      'What we never collect',
      'How to stop counting',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    }
    await expect(page.getByTestId('counting-status')).toContainText('counting switched off');
    await expect(page.getByRole('link', { name: 'crkayes.com' }).first()).toBeVisible();
  });

  test('opens from the footer with client-side navigation', async ({ page }) => {
    await page.goto('credits');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/snap-convert\/privacy$/);
    await expect(page.getByTestId('counting-status')).toBeVisible();
  });

  test('has no serious accessibility issues', async ({ page }) => {
    await page.goto('privacy');
    await expectNoSeriousA11yIssues(page);
  });
});

test('with counting off, the app sends no analytics request and sets no cookies', async ({
  page,
  context,
  browserName,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto('./');
  await page.waitForLoadState('networkidle');
  await page.goto('compress-image');
  await expect(page.getByTestId('compress-drop')).toHaveAttribute('data-live', 'true');
  // Runs the tool (track 'tool-run') and, where the image worker works, downloads (track 'download').
  await page.getByRole('button', { name: 'Try with a sample photo' }).click();
  if (browserName !== 'webkit') {
    // Playwright's WebKit has no OffscreenCanvas in workers (see compress-image.spec.ts).
    await expect(page.locator('[data-testid="compare"][data-fresh]')).toBeVisible({
      timeout: 60_000,
    });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await download;
  }
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByTestId('counting-status')).toBeVisible();
  await page.waitForLoadState('networkidle');

  const offSite = requests.filter((url) => !url.startsWith(origin) && !/^(blob|data):/.test(url));
  expect(offSite).toEqual([]);
  expect(requests.filter((url) => /\/api\/send|umami/i.test(url))).toEqual([]);
  expect(await context.cookies()).toEqual([]);
});
