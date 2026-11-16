/**
 * Layout around every tool, format and "Coming soon" page.
 * - <head>: title, description and canonical URL from the registry. Tool route files inherit this,
 *   so they don't need their own `meta` export.
 * - Below the tool: `src/tools/<id>/content.tsx` (how-to, FAQ from P22) when that file exists.
 *   Format pages use their own id (e.g. src/tools/png-to-jpg/content.tsx).
 */
import { Outlet } from 'react-router';
import { getPage } from '@/tools/registry';
import { ToolContent } from '../components/tool-content';
import { toolPageMeta } from '../meta';
import { useToolPage } from '../use-tool-page';
import type { Route } from './+types/tool-page';

// `matches` here stops at this layout (the child tool route isn't in it yet), so the page id comes
// from the URL: the last path segment is the page id (/snap-convert/png-to-jpg → png-to-jpg).
export function meta({ location }: Route.MetaArgs) {
  const page = getPage(location.pathname.split('/').filter(Boolean).pop());
  return page ? toolPageMeta(page) : [];
}

export default function ToolPageLayout() {
  const page = useToolPage();
  return (
    <>
      <Outlet />
      <ToolContent pageId={page.id} />
    </>
  );
}
