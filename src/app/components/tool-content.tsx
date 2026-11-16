import { createElement, lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';

type ContentModule = { default: ComponentType };

/** SEO content files (P22). Each one loads only on its own page. */
const modules = import.meta.glob<ContentModule>('../../tools/*/content.tsx');

/** `../../tools/compress-image/content.tsx` → `compress-image` */
export function contentIdFromPath(path: string): string | undefined {
  return /\/tools\/([^/]+)\/content\.tsx$/.exec(path)?.[1];
}

const contentById = new Map<string, LazyExoticComponent<ComponentType>>();
for (const [path, load] of Object.entries(modules)) {
  const id = contentIdFromPath(path);
  if (id) contentById.set(id, lazy(load));
}

/** Renders the page's content.tsx below the tool, if it has one. Pre-rendering waits for it. */
export function ToolContent({ pageId }: { pageId: string }) {
  const Content = contentById.get(pageId);
  if (!Content) return null;
  return (
    <Suspense fallback={null}>
      {/* createElement: the component comes from a module-level map, not created during render. */}
      {createElement(Content)}
    </Suspense>
  );
}
