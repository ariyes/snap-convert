/** Registry, routes, prerender list and <head> tags fit together. */
import { describe, expect, it } from 'vitest';
import type { RouteConfigEntry } from '@react-router/dev/routes';
import { canonicalUrl, formatPages, getPage, isFormatPage, tools } from '@/tools/registry';
import { contentIdFromPath } from './components/tool-content';
import { hasToolIcon } from './components/tool-icon';
import { pageMeta, toolPageMeta } from './meta';
import { prerenderRoutes } from './prerender-routes';
import routes from './routes';
import { pageIdFromMatches, toolRouteId } from './tool-route-id';

const ARCHITECTURE_URLS = [
  'convert-image',
  'resize-image',
  'compress-image',
  'optimize-for-web',
  'bulk-resize',
  'heic-to-jpg',
  'remove-background',
  'raw-to-jpg',
  'images-to-pdf',
  'merge-pdf',
  'split-pdf',
  'organize-pdf',
  'resize-pdf',
  'pdf-to-images',
];

function flatten(entries: RouteConfigEntry[]): RouteConfigEntry[] {
  return entries.flatMap((e) => [e, ...flatten(e.children ?? [])]);
}

describe('registry', () => {
  it('has the 14 tools from the architecture, phase 2 ones marked', () => {
    expect(tools.map((t) => t.id).sort()).toEqual([...ARCHITECTURE_URLS].sort());
    expect(tools.filter((t) => t.phase === 2).map((t) => t.id)).toEqual([
      'remove-background',
      'raw-to-jpg',
      'pdf-to-images',
    ]);
  });

  it('has the six format pages, each with from/to and reusing Convert image', () => {
    expect(formatPages.map((p) => p.id)).toEqual([
      'png-to-jpg',
      'jpg-to-png',
      'webp-to-jpg',
      'jpg-to-webp',
      'png-to-webp',
      'avif-to-jpg',
    ]);
    const png = getPage('png-to-jpg');
    expect(png && isFormatPage(png) && [png.tool, png.from, png.to]).toEqual([
      'convert-image',
      'png',
      'jpeg',
    ]);
    expect(isFormatPage(tools[0]!)).toBe(false);
  });

  it('has unique ids, names and an icon for every page', () => {
    const all = [...tools, ...formatPages];
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    expect(new Set(all.map((p) => p.name)).size).toBe(all.length);
    for (const page of all) expect(hasToolIcon(page.icon), page.icon).toBe(true);
  });
});

describe('routes', () => {
  const all = flatten(routes);
  const paths = all.map((r) => r.path).filter(Boolean);

  it('has a route for every tool and format page, plus credits, privacy and not-found', () => {
    for (const id of [...ARCHITECTURE_URLS, ...formatPages.map((p) => p.id)]) {
      expect(paths).toContain(id);
    }
    expect(paths).toEqual(expect.arrayContaining(['credits', 'privacy', '*']));
    expect(all.some((r) => r.index)).toBe(true);
  });

  it('loads each phase 1 tool from src/tools/<id>/route.tsx and format pages from Convert image', () => {
    const fileFor = (id: string) => all.find((r) => r.path === id)?.file;
    expect(fileFor('compress-image')).toBe('../tools/compress-image/route.tsx');
    expect(fileFor('png-to-jpg')).toBe('../tools/convert-image/route.tsx');
    expect(fileFor('remove-background')).toBe('routes/coming-soon.tsx');
  });

  it('gives tool routes ids that map back to the page', () => {
    const route = all.find((r) => r.path === 'avif-to-jpg');
    expect(route?.id).toBe(toolRouteId('avif-to-jpg'));
    expect(pageIdFromMatches([{ id: 'root' }, { id: 'routes/tool-page' }, route])).toBe(
      'avif-to-jpg',
    );
    expect(pageIdFromMatches([{ id: 'root' }])).toBeUndefined();
  });

  it('has no dev routes outside development', () => {
    expect(paths.filter((p) => p?.startsWith('dev'))).toEqual([]);
  });
});

describe('prerender list', () => {
  it('pre-renders home, every tool and format page, credits and privacy', () => {
    expect(prerenderRoutes).toEqual([
      '/',
      ...tools.map((t) => `/${t.id}`),
      ...formatPages.map((p) => `/${p.id}`),
      '/credits',
      '/privacy',
    ]);
    expect(prerenderRoutes.some((p) => p.includes('dev'))).toBe(false);
  });
});

describe('head tags', () => {
  it('falls back to the name and short line, with a canonical URL', () => {
    const page = getPage('compress-image')!;
    expect(toolPageMeta(page)).toEqual(
      expect.arrayContaining([
        { title: 'Compress image — Snap Convert' },
        { name: 'description', content: page.short },
        {
          tagName: 'link',
          rel: 'canonical',
          href: 'https://crkayes.com/snap-convert/compress-image',
        },
      ]),
    );
  });

  it('uses the SEO title and description when P22 fills them in', () => {
    const page = { ...getPage('merge-pdf')!, title: 'T', description: 'D' };
    expect(toolPageMeta(page)).toEqual(
      expect.arrayContaining([{ title: 'T' }, { name: 'description', content: 'D' }]),
    );
  });

  it('gives every page a unique title and description', () => {
    const all = [...tools, ...formatPages].map(toolPageMeta);
    const titles = all.map((m) => m.find((t) => 'title' in t));
    const descriptions = all.map((m) => m.find((t) => 'name' in t && t.name === 'description'));
    expect(new Set(titles.map((t) => JSON.stringify(t))).size).toBe(all.length);
    expect(new Set(descriptions.map((d) => JSON.stringify(d))).size).toBe(all.length);
  });

  it('keeps no-index pages out of search and without a canonical URL', () => {
    const tags = pageMeta({ title: 'x', description: 'y', noindex: true });
    expect(tags).toContainEqual({ name: 'robots', content: 'noindex' });
    expect(tags.some((t) => 'rel' in t)).toBe(false);
    expect(canonicalUrl()).toBe('https://crkayes.com/snap-convert/');
  });
});

describe('SEO content hook', () => {
  it('maps content.tsx paths to page ids', () => {
    expect(contentIdFromPath('../../tools/compress-image/content.tsx')).toBe('compress-image');
    expect(contentIdFromPath('../../tools/compress-image/other.tsx')).toBeUndefined();
  });
});
