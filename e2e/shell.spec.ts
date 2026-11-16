import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { formatPages, tools } from '../src/tools/registry';

const PAGES = [...tools, ...formatPages];

/** Opens the picker from the home drop box and chooses these files. */
async function chooseFiles(page: Page, files: Array<{ name: string; mimeType: string }>) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('home-drop').click();
  await (
    await chooser
  ).setFiles(files.map((f) => ({ ...f, buffer: Buffer.from(`test ${f.name}`) })));
}

const jpg = (name: string) => ({ name, mimeType: 'image/jpeg' });
const pdf = (name: string) => ({ name, mimeType: 'application/pdf' });

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

  test('has no serious accessibility issues', async ({ page }) => {
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

  test('skip link jumps to the main content; focus order follows the page', async ({
    page,
    isMobile,
    browserName,
  }) => {
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
      page.getByLabel(/Drop any files here/),
      page.getByRole('link', { name: /^Compress image/ }),
    ];
    for (const target of order) {
      await tab();
      await expect(target).toBeFocused();
    }
  });
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
    await page.goto('./merge-pdf/');
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
      await expect(page).toHaveTitle(`${tool.name} — Snap Convert`);
      if (tool.phase === 2)
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
      // Trailing slash: `vite preview` serves <path>/index.html only for it (nginx serves both).
      const response = await request.get(path ? `./${path}/` : './');
      expect(response.status(), path).toBe(200);
      const html = await response.text();
      const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
      const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1];
      expect(title, path).toBeTruthy();
      expect(description, path).toBeTruthy();
      expect(html, path).toContain(
        `<link rel="canonical" href="https://crkayes.com/snap-convert/${path}"/>`,
      );
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
    for (const path of [
      './',
      './compress-image/',
      './png-to-jpg/',
      './raw-to-jpg/',
      './credits/',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    expect(errors).toEqual([]);
  });

  test('format pages show their own heading', async ({ page }) => {
    await page.goto('./png-to-jpg/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PNG to JPG');
    await expect(page).toHaveTitle('PNG to JPG — Snap Convert');
  });
});

test.describe('drop → suggestion → tool', () => {
  test('suggests tools for the dropped files and hands them to the chosen tool', async ({
    page,
  }) => {
    await page.goto('./');
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
    await expect(page.getByText('3 files ready from the home page:')).toBeVisible();
    await expect(
      page.getByRole('list', { name: /ready from the home page/ }).getByRole('listitem'),
    ).toHaveText(['one.jpg', 'two.jpg', 'three.jpg']);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('PDF tools receive only the PDFs', async ({ page }) => {
    await page.goto('./');
    await chooseFiles(page, [jpg('photo.jpg'), pdf('a.pdf'), pdf('b.pdf')]);
    await page.getByRole('button', { name: 'Merge' }).click();
    await expect(page).toHaveURL(/\/merge-pdf$/);
    await expect(
      page.getByRole('list', { name: /ready from the home page/ }).getByRole('listitem'),
    ).toHaveText(['a.pdf', 'b.pdf']);
  });

  test('RAW files suggest RAW to JPG (coming soon); unknown files get a message; Clear hides the panel', async ({
    page,
  }) => {
    await page.goto('./');
    await chooseFiles(page, [{ name: 'shot.cr3', mimeType: 'application/octet-stream' }]);
    await expect(page.getByText('What do you want to do with 1 RAW photo?')).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Suggested tools' }).getByRole('button'),
    ).toHaveText(['RAW to JPGSoon']);

    await chooseFiles(page, [{ name: 'notes.txt', mimeType: 'text/plain' }]);
    await expect(page.getByText('What do you want to do with 1 other file?')).toBeVisible();
    await expect(page.getByText("Snap Convert doesn't handle this file type yet.")).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText(/What do you want to do with/)).toBeHidden();
  });
});

test('unknown URLs show the not-found page', async ({ page, request }) => {
  // nginx answers unknown URLs with __spa-fallback.html; `vite preview` would send the home page
  // instead, so serve the fallback here the way production does.
  const fallback = await request.get('./__spa-fallback.html');
  expect(fallback.status()).toBe(200);
  const body = await fallback.text();
  await page.route('**/snap-convert/this-page-does-not-exist', (route) =>
    route.fulfill({ status: 404, contentType: 'text/html', body }),
  );
  await page.goto('./this-page-does-not-exist');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page).toHaveTitle('Page not found — Snap Convert');
  await page.getByRole('link', { name: 'Go to all tools' }).click();
  await expect(page).toHaveURL(/\/snap-convert\/$/);
});
