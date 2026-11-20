import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { formatPages, getPage, isAvailable, tools } from '../src/tools/registry';
import { expectDelivered, watchDeliveries } from './support/delivered';

const PAGES = [...tools, ...formatPages];

interface PickedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Opens the picker from the home drop box and chooses these files. */
async function chooseFiles(page: Page, files: PickedFile[]) {
  // The pre-rendered drop box takes files once its code has loaded and hydrated.
  await expect(page.getByTestId('home-drop')).toHaveAttribute('data-live', 'true');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop any files here/ }).click();
  await (await chooser).setFiles(files);
}

// Real file bytes: the drop box reads each file's kind from its first bytes, not its name.
const bytes = (fixture: string) => readFileSync(resolve('tests/fixtures', fixture));
const jpg = (name: string) => ({
  name,
  mimeType: 'image/jpeg',
  buffer: bytes('images/no-exif.jpg'),
});
const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: bytes('intake/sample.pdf'),
});

test.describe('home', () => {
  test('loads with hero, drop box, trust strip and every tool', async ({ page }) => {
    await page.goto('./');
    await expect(page).toHaveTitle(/^Snap Convert — /);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Convert, resize and compress files, right in your browser.',
    );
    await expect(page.getByText('Drop any files here')).toBeVisible();
    await expect(page.getByText('Never stretched')).toBeVisible();
    for (const group of ['Images', 'PDF', 'Power tools']) {
      await expect(page.getByRole('heading', { level: 2, name: group })).toBeVisible();
    }
    for (const tool of tools) {
      await expect(page.getByRole('link', { name: new RegExp(`^${tool.name}`) })).toBeVisible();
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://crkayes.com/snap-convert/',
    );
  });

  test('has no serious accessibility issues', { tag: '@firefox-ci-crash' }, async ({ page }) => {
    await page.goto('./');
    await chooseFiles(page, [jpg('a.jpg'), pdf('b.pdf')]);
    await expect(page.getByText(/What do you want to do with/)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });

  test(
    'skip link jumps to the main content; focus order follows the page',
    { tag: '@firefox-ci-crash' },
    async ({ page, isMobile, browserName }) => {
      test.skip(isMobile, 'Keyboard navigation is checked on desktop');
      // Playwright's WebKit, like Safari's default setting, skips links when tabbing.
      test.skip(browserName === 'webkit', 'WebKit tabs to form fields only');
      const tab = () => page.keyboard.press('Tab');
      await page.goto('./');
      await tab();
      const skip = page.getByRole('link', { name: 'Skip to content' });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      await page.keyboard.press('Enter');
      await expect(page.locator('main#main')).toBeFocused();

      await page.goto('./');
      const order = [
        skip,
        page.getByRole('link', { name: 'Snap Convert by crkayes' }),
        page.getByRole('link', { name: 'All tools' }),
        page.getByRole('link', { name: 'Source', exact: true }),
        page.getByRole('button', { name: /^Theme:/ }),
        page.getByRole('button', { name: /^Drop any files here/ }),
        page.getByRole('link', { name: /^Compress image/ }),
      ];
      for (const target of order) {
        await tab();
        await expect(target).toBeFocused();
      }
    },
  );
});

test.describe('theme', () => {
  test('toggles and persists across reloads', async ({ page }) => {
    await page.goto('./');
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme');
    await page.getByRole('button', { name: /^Theme: follow device/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: /^Theme: light/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: /^Theme: dark/ })).toBeVisible();

    // Persists on other pages too (the theme script runs before paint on every page).
    await page.goto('./merge-pdf');
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('tool links', () => {
  test('every tool card opens its page', async ({ page }) => {
    await page.goto('./');
    for (const tool of tools) {
      await page.getByRole('link', { name: new RegExp(`^${tool.name}`) }).click();
      await expect(page).toHaveURL(new RegExp(`/snap-convert/${tool.id}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(tool.name);
      await expect(page).toHaveTitle(tool.title ?? `${tool.name} — Snap Convert`);
      if (!isAvailable(tool))
        await expect(page.getByRole('heading', { name: 'Coming soon', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'All tools' }).first().click();
      await expect(page).toHaveURL(/\/snap-convert\/$/);
    }
  });

  test('every page is its own static HTML file with a unique title, description and canonical URL', async ({
    request,
  }) => {
    const seen = { titles: new Set<string>(), descriptions: new Set<string>() };
    for (const path of ['', ...PAGES.map((p) => p.id), 'credits', 'privacy']) {
      const response = await request.get(`./${path}`);
      expect(response.status(), path).toBe(200);
      const html = await response.text();
      const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
      const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1];
      expect(title, path).toBeTruthy();
      expect(description, path).toBeTruthy();
      const page = getPage(path);
      if (page && !isAvailable(page)) {
        // Tools not built yet stay out of search results until they ship.
        expect(html, path).toContain('<meta name="robots" content="noindex"/>');
        expect(html, path).not.toContain('rel="canonical"');
      } else {
        expect(html, path).toContain(
          `<link rel="canonical" href="https://crkayes.com/snap-convert/${path}"/>`,
        );
      }
      seen.titles.add(title!);
      seen.descriptions.add(description!);
    }
    expect(seen.titles.size).toBe(PAGES.length + 3);
    expect(seen.descriptions.size).toBe(PAGES.length + 3);
  });

  test('pre-rendered pages hydrate without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    for (const url of ['./', './compress-image', './png-to-jpg', './raw-to-jpg', './credits']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
    }
    expect(errors).toEqual([]);
  });

  test('format pages show their own heading', async ({ page }) => {
    await page.goto('./png-to-jpg');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PNG to JPG');
    await expect(page).toHaveTitle('PNG to JPG Converter — Free, No Upload | Snap Convert');
  });
});

test.describe('drop → suggestion → tool', () => {
  test('suggests tools for the dropped files and hands them to the chosen tool', async ({
    page,
  }) => {
    await page.goto('./');
    await watchDeliveries(page);
    await chooseFiles(page, [jpg('one.jpg'), jpg('two.jpg'), jpg('three.jpg'), pdf('doc.pdf')]);
    await expect(page.getByText('What do you want to do with 3 images and 1 PDF?')).toBeVisible();
    const chips = page.getByRole('list', { name: 'Suggested tools' }).getByRole('button');
    await expect(chips).toHaveText([
      'Compress',
      'Resize',
      'Convert',
      'Optimize for web',
      'Make a PDF',
      'Remove backgroundSoon',
      'Merge',
      'Split',
      'Organize pages',
      'Resize pages',
    ]);

    // Scroll down first: opening a tool starts at the top of the new screen.
    await page.evaluate(() => window.scrollTo(0, 300));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await chips.filter({ hasText: 'Compress' }).click();
    await expect(page).toHaveURL(/\/compress-image$/);
    await expectDelivered(page, 'compress-image', ['one.jpg', 'two.jpg', 'three.jpg']);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('PDF tools receive only the PDFs', async ({ page }) => {
    await page.goto('./');
    await watchDeliveries(page);
    await chooseFiles(page, [jpg('photo.jpg'), pdf('a.pdf'), pdf('b.pdf')]);
    await page.getByRole('button', { name: 'Merge' }).click();
    await expect(page).toHaveURL(/\/merge-pdf$/);
    await expectDelivered(page, 'merge-pdf', ['a.pdf', 'b.pdf']);
  });

  test('RAW files suggest RAW to JPG; unknown files get a message; Clear hides the panel', async ({
    page,
  }) => {
    await page.goto('./');
    await chooseFiles(page, [
      {
        name: 'shot.cr3',
        mimeType: 'application/octet-stream',
        buffer: bytes('intake/sample.cr3'),
      },
    ]);
    await expect(page.getByText('What do you want to do with 1 RAW photo?')).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Suggested tools' }).getByRole('button'),
    ).toHaveText(['RAW to JPG']);

    await chooseFiles(page, [
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Just some notes.') },
    ]);
    await expect(page.getByText('What do you want to do with 1 other file?')).toBeVisible();
    await expect(page.getByText("Snap Convert doesn't handle this file type yet.")).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText(/What do you want to do with/)).toBeHidden();
  });
});

test.describe('URLs like nginx', () => {
  test('pages load without a trailing slash, and with one', async ({ request }) => {
    for (const url of ['./png-to-jpg', './png-to-jpg/', './compress-image', './credits']) {
      const response = await request.get(url);
      expect(response.status(), url).toBe(200);
      expect(response.headers()['content-type'], url).toMatch(/^text\/html/);
      const id = url.replace(/^\.\/|\/$/g, '');
      expect(await response.text(), url).toContain(
        `<link rel="canonical" href="https://crkayes.com/snap-convert/${id}"/>`,
      );
    }
  });

  test('unknown URLs get the SPA fallback with status 404', async ({ request }) => {
    const fallback = await (await request.get('./__spa-fallback.html')).text();
    for (const url of [
      './this-page-does-not-exist',
      './nested/missing/page',
      './png-to-jpg/nope',
    ]) {
      const response = await request.get(url);
      expect(response.status(), url).toBe(404);
      expect(response.headers()['cross-origin-opener-policy'], url).toBe('same-origin');
      expect(response.headers()['cross-origin-embedder-policy'], url).toBe('require-corp');
      expect(await response.text(), url).toBe(fallback);
    }
  });
});

test('unknown URLs show the not-found page', async ({ page }) => {
  const response = await page.goto('./this-page-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page).toHaveTitle('Page not found — Snap Convert');
  await page.getByRole('link', { name: 'Go to all tools' }).click();
  await expect(page).toHaveURL(/\/snap-convert\/$/);
});
