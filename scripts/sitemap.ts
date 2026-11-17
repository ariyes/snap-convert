import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prerenderRoutes } from '../src/app/prerender-routes';
import { getPage, isAvailable, SITE_URL } from '../src/tools/registry';

/**
 * sitemap.xml for search engines (P22), written into the build folder after pre-rendering, so it
 * is served at https://crkayes.com/snap-convert/sitemap.xml.
 *
 * It lists exactly the pre-rendered pages (home, every tool and format page from the registry,
 * credits, privacy), each once, at the same address as the page's canonical link. No <lastmod>:
 * the build date would claim every page changed on every deploy, and Google ignores
 * <changefreq>/<priority>.
 */

/** Absolute page URLs from pre-render paths ("/" → the site, "/merge-pdf" → …/merge-pdf), no repeats. */
export function sitemapUrls(
  routes: readonly string[] = prerenderRoutes,
  site: string = SITE_URL,
): string[] {
  // Pages for tools that aren't built yet are left out (and marked noindex) until they ship.
  const listed = routes.filter((route) => {
    const page = getPage(route.replace(/^\/+|\/+$/g, ''));
    return !page || isAvailable(page);
  });
  const urls = listed.map((route) => {
    const rel = route.replace(/^\/+|\/+$/g, '');
    return rel ? `${site}${rel}` : site;
  });
  return [...new Set(urls)];
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sitemapXml(urls: readonly string[]): string {
  const entries = urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${entries}\n` +
    '</urlset>\n'
  );
}

/** Writes sitemap.xml into the client build folder (called from react-router.config.ts buildEnd). */
export async function writeSitemap(clientDir: string): Promise<void> {
  await writeFile(path.join(clientDir, 'sitemap.xml'), sitemapXml(sitemapUrls()), 'utf8');
}
