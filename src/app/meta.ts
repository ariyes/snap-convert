/** <head> tags for every page: title, description, canonical URL and the basic social tags. */
import type { MetaDescriptor } from 'react-router';
import { canonicalUrl, type PageMeta } from '@/tools/registry';
import { appStrings } from './strings';

export interface PageHead {
  title: string;
  description: string;
  /** Page id for the canonical URL (`https://crkayes.com/snap-convert/<id>`); omit for the home page. */
  id?: string;
  /** Keep the page out of search results (not-found, dev pages). */
  noindex?: boolean;
}

export function pageMeta({ title, description, id, noindex = false }: PageHead): MetaDescriptor[] {
  const url = canonicalUrl(id);
  const tags: MetaDescriptor[] = [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Snap Convert' },
  ];
  if (noindex) tags.push({ name: 'robots', content: 'noindex' });
  else
    tags.push(
      { tagName: 'link', rel: 'canonical', href: url },
      { property: 'og:url', content: url },
    );
  return tags;
}

/** Head for a tool or format page: SEO fields from P22 when present, else name and short line. */
export function toolPageMeta(page: PageMeta): MetaDescriptor[] {
  return pageMeta({
    title: page.title ?? appStrings.pageTitle(page.name),
    description: page.description ?? page.short,
    id: page.id,
  });
}
