// Has this tool's engine been downloaded (and cached) yet? Used to explain, while offline, why a
// tool can't run. Loaded lazily with the service worker controller, never at startup.
import type { JobKind } from '@/core/contracts';
import { getPage, isAvailable, isFormatPage } from '@/tools/registry';
import type { EngineGraph } from './build-time/shell';
import { ENGINE_GRAPH_FILE } from './cache-names';

/**
 * The engines' worker URLs. Same `?worker&url` modules as the queue's registry
 * (src/core/queue/registry.ts), so Vite gives back the very same worker files.
 */
const workerUrls = import.meta.glob<string>(
  ['../engines/image/worker.ts', '../engines/pdf/worker.ts'],
  { query: '?worker&url', import: 'default' },
);

const WORKER_MODULES: Record<JobKind, string> = {
  image: '../engines/image/worker.ts',
  pdf: '../engines/pdf/worker.ts',
};

/** The engine a page's tool needs to run (its main worker), or null for non-tool pages. */
export function engineFor(pageId: string | undefined): JobKind | null {
  const page = getPage(pageId);
  if (!page || !isAvailable(page)) return null;
  if (isFormatPage(page)) return 'image';
  // PDF to images reads and draws pages with pdf.js (cached on first use like every engine file)
  // and encodes them in the image worker.
  if (page.id === 'pdf-to-images') return 'image';
  if (page.id === 'images-to-pdf' || page.accepts.includes('pdf')) return 'pdf';
  return 'image';
}

/** The first path segment under the base: "/compress-image" → "compress-image". */
export function pageIdFromPath(pathname: string): string | undefined {
  return pathname.split('/').find((s) => s.length > 0);
}

/**
 * Files that `root` loads, directly or not (itself included), from the build's engine list.
 * Names are relative to assets/.
 */
export function engineClosure(graph: EngineGraph, root: string): string[] {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    const file = graph.files[name];
    if (!file) continue;
    seen.add(name);
    stack.push(...file.refs);
  }
  return [...seen];
}

/** "2.1 MB"; at least 0.1 MB. */
export function formatMegabytes(bytes: number): string {
  const mb = Math.max(0.1, Math.round(bytes / 100_000) / 10);
  return `${mb.toFixed(1)} MB`;
}

export interface EngineStatus {
  /** The tool's engine worker is in the cache: the tool has run here before. */
  cached: boolean;
  /** Bytes still to download for everything this engine may load, or null if unknown. */
  missingBytes: number | null;
}

export interface EngineCheckDeps {
  workerUrl(kind: JobKind): Promise<string>;
  isCached(url: string): Promise<boolean>;
  loadGraph(): Promise<EngineGraph | null>;
  /** Absolute URL of assets/ ("https://…/snap-convert/assets/"). */
  assetsUrl: string;
}

/** Whether `kind`'s engine is cached; if not, how much it still needs to download (at most). */
export async function checkEngine(kind: JobKind, deps: EngineCheckDeps): Promise<EngineStatus> {
  const worker = new URL(await deps.workerUrl(kind), deps.assetsUrl).href;
  if (await deps.isCached(worker)) return { cached: true, missingBytes: 0 };
  const graph = await deps.loadGraph().catch(() => null);
  const name = worker.startsWith(deps.assetsUrl) ? worker.slice(deps.assetsUrl.length) : '';
  if (!graph || !graph.files[name]) return { cached: false, missingBytes: null };
  let missing = 0;
  for (const file of engineClosure(graph, name)) {
    if (!(await deps.isCached(new URL(file, deps.assetsUrl).href))) {
      missing += graph.files[file]?.bytes ?? 0;
    }
  }
  return { cached: false, missingBytes: missing };
}

/** Real dependencies: the worker URLs from Vite, the Cache Storage, the precached engine list. */
export function browserEngineDeps(base: string): EngineCheckDeps {
  const assetsUrl = new URL(`${base}assets/`, location.href).href;
  return {
    assetsUrl,
    async workerUrl(kind) {
      const load = workerUrls[WORKER_MODULES[kind]];
      if (!load) throw new Error(`No ${kind} worker in this build`);
      return load();
    },
    async isCached(url) {
      try {
        return (await caches.match(url)) !== undefined;
      } catch {
        return false;
      }
    },
    async loadGraph() {
      const res = await fetch(`${base}${ENGINE_GRAPH_FILE}`);
      return res.ok ? ((await res.json()) as EngineGraph) : null;
    },
  };
}
