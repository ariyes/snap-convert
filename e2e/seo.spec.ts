/** Search content (P22): sitemap, robots.txt, <head> tags of every page, how-to and FAQ on tool pages. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { prerenderRoutes } from '../src/app/prerender-routes';
import { canonicalUrl, formatPages, isAvailable, SITE_URL, tools } from '../src/tools/registry';

/** Every page the build pre-renders, as its public URL. */
const notBuiltYet = new Set([...tools, ...formatPages].filter((p) => !isAvailable(p)).map((p) => p.id));
const EXPECTED_URLS = prerenderRoutes
  .filter((r) => !notBuiltYet.has(r.slice(1)))
  .map((r) => (r === '/' ? SITE_URL : canonicalUrl(r.slice(1))));

async function sitemapLocs(request: APIRequestContext): Promise<string[]> {
  const res = await request.get('sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** <head> facts from a page's pre-rendered HTML (what a search engine reads before any script). */
function headOf(html: string) {
  const attr = (re: RegExp) => {
    const m = re.exec(html);
    return m ? decode(m[1]!) : undefined;
  };
  return {
    title: attr(/<title>([^<]*)<\/title>/),
    description: attr(/<meta name="description" content="([^"]*)"/),
    canonical: attr(/<link rel="canonical" href="([^"]*)"/),
    robots: attr(/<meta name="robots" content="([^"]*)"/),
    h1Count: (html.match(/<h1[\s>]/g) ?? []).length,
  };
}

test.describe('sitemap and robots.txt', () => {
  // Plain HTTP checks: once is enough.
  test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile, 'HTTP only');

  test('sitemap lists every public page exactly once', async ({ request }) => {
    const locs = await sitemapLocs(request);
    expect(new Set(locs).size).toBe(locs.length);
    expect([...locs].sort()).toEqual([...EXPECTED_URLS].sort());
    for (const p of [...tools, ...formatPages]) {
      if (isAvailable(p)) expect(locs).toContain(canonicalUrl(p.id));
      else expect(locs).not.toContain(canonicalUrl(p.id));
    }
  });

  test('robots.txt allows the app and points to the sitemap', async ({ request }) => {
    const res = await request.get('robots.txt');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/^User-agent: \*$/m);
    expect(text).toMatch(/^Allow: \/snap-convert\/$/m);
    expect(text).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
    expect(text).not.toMatch(/^Disallow:/m);
  });

  test('every page in the sitemap has a unique title and description and points to itself', async ({
    request,
  }) => {
    const locs = await sitemapLocs(request);
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const loc of locs) {
      const res = await request.get(loc.replace(SITE_URL, './') || './');
      expect(res.status(), loc).toBe(200);
      const head = headOf(await res.text());
      expect(head.title, loc).toBeTruthy();
      expect(head.description, loc).toBeTruthy();
      expect(head.canonical, loc).toBe(loc);
      expect(head.robots, loc).toBeUndefined();
      expect(head.h1Count, `${loc} has one h1`).toBe(1);
      titles.add(head.title!);
      descriptions.add(head.description!);
      // Tool and format pages are P22's; home, credits and privacy are checked for presence only.
      const page = [...tools, ...formatPages].find((p) => canonicalUrl(p.id) === loc);
      if (page) {
        expect(head.title!.length, loc).toBeLessThanOrEqual(60);
        expect(head.description!.length, loc).toBeLessThanOrEqual(155);
        expect(head.title).toBe(page.title);
        expect(head.description).toBe(page.description);
      }
    }
    expect(titles.size, 'unique titles').toBe(locs.length);
    expect(descriptions.size, 'unique descriptions').toBe(locs.length);
  });

  test('social preview images are 1200 × 630 PNGs', async ({ request }) => {
    for (const name of ['home', 'images', 'pdf']) {
      const res = await request.get(`og/${name}.png`);
      expect(res.status(), name).toBe(200);
      const png = await res.body();
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], name).toEqual([1200, 630]);
    }
  });
});

test.describe('how-to and FAQ', () => {
  test('the how-to and FAQ text is in the pre-rendered HTML', async ({
    request,
    browserName,
    isMobile,
  }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'HTTP only');
    const html = await (await request.get('./compress-image')).text();
    expect(html).toContain('How to compress images');
    expect(html).toContain('Drag the before/after slider to compare');
    expect(html).toContain('Questions and answers');
    expect(html).toContain('Is it really free?');
    expect(html).toContain('A target file size works with JPG, WebP and AVIF.');
  });

  test('a tool page shows its steps and FAQ', async ({ page }) => {
    await page.goto('compress-image');
    const content = page.getByTestId('tool-seo-content');
    await expect(
      content.getByRole('heading', { level: 2, name: 'How to compress images' }),
    ).toBeVisible();
    await expect(content.getByRole('listitem')).toHaveCount(4);
    await expect(
      content.getByRole('heading', { level: 2, name: 'Questions and answers' }),
    ).toBeVisible();
    await expect(content.locator('details')).toHaveCount(6);

    // Answers start collapsed and open on tap or click.
    const answer = content.getByText('Snap Convert is free and open source');
    await expect(answer).toBeHidden();
    await content.getByText('Is it really free?').click();
    await expect(answer).toBeVisible();
  });

  test('FAQ opens with the keyboard', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard is checked on desktop');
    await page.goto('merge-pdf');
    const content = page.getByTestId('tool-seo-content');
    const answer = content.getByText('Pages keep their original size, quality and rotation.');
    await expect(answer).toBeHidden();
    await content.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    await expect(answer).toBeVisible();
  });

  test('format pages have their own content; coming-soon pages have none', async ({ page }) => {
    await page.goto('png-to-jpg');
    await expect(
      page.getByRole('heading', { level: 2, name: 'How to convert PNG to JPG' }),
    ).toBeVisible();
    for (const soon of tools.filter((t) => !isAvailable(t))) {
      await page.goto(soon.id);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(soon.name));
      await expect(page.getByTestId('tool-seo-content')).toHaveCount(0);
    }
  });

  test('content has no serious accessibility issues', async ({ page }) => {
    await page.goto('split-pdf');
    const content = page.getByTestId('tool-seo-content');
    await content.locator('summary').first().click();
    const results = await new AxeBuilder({ page })
      .include('[data-testid="tool-seo-content"]')
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
});
