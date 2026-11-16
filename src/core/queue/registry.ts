// Worker registry: JobKind → a factory that creates that kind's module worker.
//
// The engines' workers are created by other tasks (image: P12, pdf: P07). They are found with
// `import.meta.glob` instead of a hard-coded `new Worker(new URL(…))`, because Vite's build fails
// on a `new URL(…)` worker whose file doesn't exist yet, while a glob simply has no entry for it.
// Each glob entry is loaded lazily and only returns the bundled worker's URL (`?worker&url`), so
// no engine code enters the startup bundle; the factory then does `new Worker(url, { type: 'module' })`.
// When the worker file lands, it is picked up automatically — nothing to wire up.

import type { JobKind } from '@/core/contracts';

export type WorkerFactory = () => Worker | Promise<Worker>;
export type WorkerRegistry = Readonly<Record<JobKind, WorkerFactory>>;
/** Glob result: module path → loader of the worker's URL. */
export type WorkerUrlLoaders = Readonly<Record<string, () => Promise<string>>>;

/** Where each kind's worker lives, relative to this file (must match the glob below). */
export const WORKER_MODULES = {
  image: '../../engines/image/worker.ts',
  pdf: '../../engines/pdf/worker.ts',
} as const satisfies Record<JobKind, string>;

const engineWorkerUrls: WorkerUrlLoaders = import.meta.glob<string>(
  ['../../engines/image/worker.ts', '../../engines/pdf/worker.ts'],
  { query: '?worker&url', import: 'default' },
);

/** The worker module for a kind isn't in this build (not written yet, or failed to load). */
export class WorkerUnavailableError extends Error {
  constructor(readonly kind: string) {
    super(`No worker available for "${kind}" jobs`);
    this.name = 'WorkerUnavailableError';
  }
}

/** A factory that loads `path` from `loaders` and starts it as a module worker. */
export function moduleWorkerFactory(
  loaders: WorkerUrlLoaders,
  path: string,
  name: string,
): WorkerFactory {
  return async () => {
    const load = loaders[path];
    if (!load) throw new WorkerUnavailableError(name);
    let url: string;
    try {
      url = await load();
    } catch (_err) {
      throw new WorkerUnavailableError(name);
    }
    return new Worker(url, { type: 'module', name: `snap-convert-${name}` });
  };
}

/** Kinds whose worker module exists in this build. */
export function availableKinds(loaders: WorkerUrlLoaders = engineWorkerUrls): JobKind[] {
  return (Object.keys(WORKER_MODULES) as JobKind[]).filter((k) => WORKER_MODULES[k] in loaders);
}

export const defaultRegistry: WorkerRegistry = {
  image: moduleWorkerFactory(engineWorkerUrls, WORKER_MODULES.image, 'image'),
  pdf: moduleWorkerFactory(engineWorkerUrls, WORKER_MODULES.pdf, 'pdf'),
};
