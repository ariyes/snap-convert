/**
 * Every route in the app (P10). Paths are relative to the basename /snap-convert/; files are relative
 * to src/app. React Router loads each route file as its own chunk, on demand.
 *
 * - Tool pages render `src/tools/<id>/route.tsx` inside `routes/tool-page.tsx`, which sets the <head>
 *   from the registry and adds the tool's optional SEO content below.
 * - Format pages (png-to-jpg, …) reuse Convert image's route file under their own route id.
 * - Phase 2 tools get a "Coming soon" page.
 * - /dev/* review pages exist only in development (never built or pre-rendered).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  type RouteConfig,
  type RouteConfigEntry,
  getAppDirectory,
  index,
  layout,
  route,
} from '@react-router/dev/routes';
import { formatPages, isAvailable, tools } from '../tools/registry';
import { toolRouteId } from './tool-route-id';

const toolRoutes = tools.map((tool) =>
  isAvailable(tool)
    ? route(tool.id, `../tools/${tool.id}/route.tsx`, { id: toolRouteId(tool.id) })
    : route(tool.id, 'routes/coming-soon.tsx', { id: toolRouteId(tool.id) }),
);

const formatRoutes = formatPages.map((page) =>
  route(page.id, `../tools/${page.tool}/route.tsx`, { id: toolRouteId(page.id) }),
);

function devRoutes(): RouteConfigEntry[] {
  if (process.env.NODE_ENV !== 'development') return [];
  const entries = [route('dev/ui', '../ui/showcase.tsx')];
  // P13 adds the tool-layout demo; register it once the file exists.
  const layoutDemo = '../features/tool-layout/demo.tsx';
  if (existsSync(path.resolve(getAppDirectory(), layoutDemo))) {
    entries.push(route('dev/layout', layoutDemo));
  }
  return entries;
}

export default [
  layout('routes/shell.tsx', [
    index('routes/home.tsx'),
    layout('routes/tool-page.tsx', [...toolRoutes, ...formatRoutes]),
    route('credits', '../pages/credits.tsx'),
    route('privacy', '../pages/privacy.tsx'),
    route('*', 'routes/not-found.tsx'),
  ]),
  // Outside the shell: review pages bring their own frame.
  ...devRoutes(),
] satisfies RouteConfig;
