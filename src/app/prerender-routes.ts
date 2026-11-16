/**
 * Paths pre-rendered to static HTML at build time (relative to the basename). Read by
 * react-router.config.ts. Generated from the registry: home, every tool page (phase 2 ones show
 * "Coming soon"), every format page, credits and privacy. Dev pages and not-found are not included.
 */
import { formatPages, tools } from '../tools/registry';

export const prerenderRoutes: string[] = [
  '/',
  ...tools.map((t) => `/${t.id}`),
  ...formatPages.map((p) => `/${p.id}`),
  '/credits',
  '/privacy',
];
