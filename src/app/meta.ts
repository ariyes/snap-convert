/** <head> tags for every page: title, description, canonical URL and the basic social tags. */
import type { MetaDescriptor } from 'react-router';
import {
  canonicalUrl,
  isAvailable,
  OG_IMAGE_SIZE,
  ogImageUrl,
  type PageMeta,
} from '@/tools/registry';
import { appStrings } from './strings';

export interface PageHead {
  title: string;
  description: string;
  /** Page id for the canonical URL (`https://crkayes.com/snap-convert/<id>`); omit for the home page. */
  id?: string;
  /** Keep the page out of search results (not-found, dev pages, tools that aren't built yet). */
  noindex?: boolean;
  /** Social preview image (absolute URL); defaults to the home image. */
  image?: string;
}

export function pageMeta({
  title,
  description,
  id,
  noindex = false,
  image = ogImageUrl(),
}: PageHead): MetaDescriptor[] {
  const url = canonicalUrl(id);
  const tags: MetaDescriptor[] = [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Snap Convert' },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: String(OG_IMAGE_SIZE.width) },
    { property: 'og:image:height', content: String(OG_IMAGE_SIZE.height) },
    { name: 'twitter:card', content: 'summary_large_image' },
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
    image: ogImageUrl(page),
    // Tools that aren't built yet stay out of search results until they ship (owner, 2026-11-17).
    noindex: !isAvailable(page),
  });
}
