/** SEO fields (P22): every page has them, within search-result limits; sitemap and structured data. */
import { describe, expect, it } from 'vitest';
import { sitemapUrls, sitemapXml } from '../../scripts/sitemap';
import { contentIdFromPath } from '../app/components/tool-content';
import { prerenderRoutes } from '../app/prerender-routes';
import {
  canonicalUrl,
  formatPages,
  homeStructuredData,
  isAvailable,
  ogImageUrl,
  SITE_URL,
  tools,
} from './registry';

const pages = [...tools, ...formatPages];
const working = pages.filter(isAvailable);
const comingSoon = pages.filter((p) => !isAvailable(p));

/** Content files that exist, by page id (the shared renderer is not a page). */
const contentIds = Object.keys(import.meta.glob('./*/content.tsx'))
  .map((p) => contentIdFromPath(p.replace(/^\./, '/tools')))
  .filter((id) => id !== '_shared');

/** Words spelled differently in British and American English; the copy avoids them. */
const SPELLING =
  /\b(colou?rs?|cent(re|er)(d|ed)?|gr[ae]y|favou?rite|optimis(e|ed|ing)|licen[cs]e)\b/i;

describe('SEO fields', () => {
  it.each(pages.map((p) => [p.id, p] as const))(
    '%s has a title ≤ 60 and description ≤ 155',
    (_, p) => {
      expect(p.title, 'title').toBeTruthy();
      expect(p.description, 'description').toBeTruthy();
      expect(p.title!.length).toBeLessThanOrEqual(60);
      expect(p.title).toMatch(/ \| Snap Convert$/);
      // Long enough to say something useful; short enough not to be cut off.
      expect(p.description!.length).toBeGreaterThanOrEqual(100);
      expect(p.description!.length).toBeLessThanOrEqual(155);
    },
  );

  it('titles and descriptions are unique (home included)', () => {
    const titles = pages.map((p) => p.title);
    const descriptions = pages.map((p) => p.description);
    expect(new Set(titles).size).toBe(pages.length);
    expect(new Set(descriptions).size).toBe(pages.length);
  });

  it.each(working.map((p) => [p.id, p] as const))('%s has 3–5 steps and 4–6 questions', (_, p) => {
    expect(p.howTo?.length).toBeGreaterThanOrEqual(3);
    expect(p.howTo?.length).toBeLessThanOrEqual(5);
    expect(p.faq?.length).toBeGreaterThanOrEqual(4);
    expect(p.faq?.length).toBeLessThanOrEqual(6);
    const questions = p.faq!.map((f) => f.q);
    expect(new Set(questions).size, 'no repeated question').toBe(questions.length);
    for (const f of p.faq!) {
      expect(f.q).toMatch(/\?$/);
      expect(f.a.length).toBeGreaterThan(20);
    }
  });

  it('every working tool says whether files are uploaded and works on phones', () => {
    for (const p of working) {
      const text = p.faq!.map((f) => `${f.q} ${f.a}`).join(' ');
      expect(text, p.id).toMatch(/never (leave your device|sent to a server)/);
      expect(text, p.id).toMatch(/phone/i);
    }
  });

  it('"coming soon" tools say so and carry no how-to or FAQ', () => {
    expect(comingSoon.map((p) => p.id)).toEqual([
      'remove-background',
      'raw-to-jpg',
      'pdf-to-images',
    ]);
    for (const p of comingSoon) {
      expect(p.title).toMatch(/Coming Soon/);
      expect(p.description).toMatch(/^Coming soon:/);
      expect(p.howTo).toBeUndefined();
      expect(p.faq).toBeUndefined();
    }
  });

  it('copy uses spelling that reads the same in British and American English', () => {
    for (const p of pages) {
      const copy = [
        p.title,
        p.description,
        ...(p.howTo ?? []),
        ...(p.faq ?? []).flatMap((f) => [f.q, f.a]),
      ].join(' ');
      expect(SPELLING.exec(copy)?.[0], p.id).toBeUndefined();
    }
  });

  it('every working page has a content file, and coming-soon pages have none', () => {
    expect([...contentIds].sort()).toEqual(working.map((p) => p.id).sort());
  });
});

describe('sitemap', () => {
  const urls = sitemapUrls();

  it('lists every pre-rendered page exactly once, at its canonical address', () => {
    expect(urls).toHaveLength(prerenderRoutes.length);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls[0]).toBe(SITE_URL);
    for (const p of pages) expect(urls).toContain(canonicalUrl(p.id));
    expect(urls).toEqual(
      expect.arrayContaining([canonicalUrl('credits'), canonicalUrl('privacy')]),
    );
    for (const url of urls) expect(url.startsWith(SITE_URL)).toBe(true);
  });

  it('drops repeats and slashes', () => {
    expect(sitemapUrls(['/', '/a', '/a/', 'b'], 'https://x.test/app/')).toEqual([
      'https://x.test/app/',
      'https://x.test/app/a',
      'https://x.test/app/b',
    ]);
  });

  it('writes valid, escaped sitemap XML', () => {
    const xml = sitemapXml(['https://x.test/?a=1&b=<2>']);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://x.test/?a=1&amp;b=&lt;2&gt;</loc>');
    const doc = new DOMParser().parseFromString(sitemapXml(urls), 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect([...doc.getElementsByTagName('loc')].map((n) => n.textContent)).toEqual(urls);
  });
});

describe('social images and structured data', () => {
  it('uses one image per group, and the home image for the rest', () => {
    expect(ogImageUrl()).toBe(`${SITE_URL}og/home.png`);
    expect(ogImageUrl(tools.find((t) => t.id === 'compress-image'))).toBe(
      `${SITE_URL}og/images.png`,
    );
    expect(ogImageUrl(formatPages[0])).toBe(`${SITE_URL}og/images.png`);
    expect(ogImageUrl(tools.find((t) => t.id === 'merge-pdf'))).toBe(`${SITE_URL}og/pdf.png`);
    expect(ogImageUrl(tools.find((t) => t.id === 'raw-to-jpg'))).toBe(`${SITE_URL}og/home.png`);
  });

  it('home is a free SoftwareApplication that runs on the web', () => {
    expect(homeStructuredData).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Snap Convert',
      operatingSystem: 'Web',
      url: SITE_URL,
      offers: { '@type': 'Offer', price: '0' },
    });
    // No made-up ratings or reviews.
    expect(homeStructuredData).not.toHaveProperty('aggregateRating');
    expect(homeStructuredData).not.toHaveProperty('review');
    expect(JSON.parse(JSON.stringify(homeStructuredData))).toEqual(homeStructuredData);
  });
});
