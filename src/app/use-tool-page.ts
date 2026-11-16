import { useMatches } from 'react-router';
import { getPage, type PageMeta } from '@/tools/registry';
import { pageIdFromMatches } from './tool-route-id';

/**
 * The registry entry of the tool or format page being shown. Format pages (e.g. png-to-jpg) render
 * Convert image's route and get a `FormatPageMeta` here, with `from`/`to` to pre-set the target.
 * Throws when used outside a tool route.
 */
export function useToolPage(): PageMeta {
  const page = getPage(pageIdFromMatches(useMatches()));
  if (!page) throw new Error('useToolPage() must be used inside a tool route');
  return page;
}
