// Build-time (Node) glue for vite-plugin-pwa (P21). Used only by the VitePWA block in vite.config.ts.
//
// React Router pre-renders the pages and moves them into place (scripts/flatten-prerender.ts)
// after the client build, so vite-plugin-pwa's own service worker step (at the end of the client
// build) sees no HTML yet. `finalize()` runs once everything is built and flattened, writes the
// engine file list, and generates the service worker again from the final file layout.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { VitePluginPWAAPI, VitePWAOptions } from 'vite-plugin-pwa';
import { APP_BASE } from '../brand.ts';
import { ENGINE_CACHE, ENGINE_GRAPH_FILE, RUNTIME_PREFIXES } from '../cache-names.ts';
import {
  ASSETS_DIR,
  buildEngineGraph,
  findShellAssets,
  isAppChunk,
  listFiles,
  pageUrl,
} from './shell.ts';

type WorkboxOptions = NonNullable<VitePWAOptions['workbox']>;
type ManifestTransform = NonNullable<WorkboxOptions['manifestTransforms']>[number];

interface FinalState {
  shell: Set<string>;
  importScripts: string[];
}

/** Service worker add-on: on activate, drop cached engine files that aren't in this version. */
function cleanupScript(keep: string[]): string {
  return `// Snap Convert (P21): engine files are cached once used, under content-hashed names.
// A new version keeps the ones it still uses and deletes the rest.
self.addEventListener('activate', (event) => {
  const keep = new Set(${JSON.stringify(keep)}.map((f) => new URL(f, self.registration.scope).href));
  event.waitUntil(
    caches.open(${JSON.stringify(ENGINE_CACHE)}).then((cache) =>
      cache.keys().then((requests) =>
        Promise.all(requests.filter((r) => !keep.has(r.url)).map((r) => cache.delete(r))),
      ),
    ),
  );
});
`;
}

export function createPwaBuild(options: { outDir: string }) {
  let final: FinalState | null = null;
  let clientDir = path.resolve(options.outDir);

  /** Precache only the shell: pages (under the URLs the site links to), scripts, styles, fonts. */
  const precacheTransform: ManifestTransform = (entries) => {
    const shell = final?.shell ?? new Set<string>();
    const manifest = entries
      .filter((e) => !e.url.startsWith(`${ASSETS_DIR}/`) || shell.has(e.url))
      .map((e) => ({ ...e, url: pageUrl(e.url) }));
    return Promise.resolve({ manifest, warnings: [] });
  };

  let globPatterns: string[] | undefined;
  const integration: NonNullable<VitePWAOptions['integration']> = {
    // vite-plugin-pwa also generates a service worker at the end of each environment's build,
    // before the pages are pre-rendered; finalize() overwrites it. Those early runs precache
    // nothing, so they don't warn about pages and files that don't exist yet.
    beforeBuildServiceWorker(resolved) {
      globPatterns ??= resolved.workbox.globPatterns ?? [];
      resolved.workbox.globPatterns = final ? globPatterns : [];
      resolved.workbox.importScripts = final?.importScripts ?? [];
    },
  };

  /** Must come after reactRouter() in `plugins`, so it runs after pre-rendering. */
  function finalize(): Plugin {
    let api: VitePluginPWAAPI | undefined;
    const appChunks = new Set<string>();
    return {
      name: 'snap-convert:pwa-finalize',
      apply: 'build',
      enforce: 'post',
      sharedDuringBuild: true,
      configResolved(config) {
        const pwa = config.plugins.find((p) => p.name === 'vite-plugin-pwa');
        api = (pwa as { api?: VitePluginPWAAPI } | undefined)?.api;
        clientDir = path.resolve(config.root, options.outDir);
      },
      // Remember the client build's app chunks (route modules, lazy app code) for the shell.
      generateBundle(_options, bundle) {
        if (this.environment.name !== 'client') return;
        for (const file of Object.values(bundle)) {
          if (file.type === 'chunk' && isAppChunk(file)) appChunks.add(file.fileName);
        }
      },
      buildApp: {
        order: 'post',
        async handler() {
          if (!api || api.disabled) return;
          const shell = findShellAssets(clientDir, APP_BASE, appChunks);
          const graph = buildEngineGraph(clientDir, shell);
          writeFileSync(path.join(clientDir, ENGINE_GRAPH_FILE), JSON.stringify(graph));

          // Runtime-cached files of this version (engine files and public files such as samples).
          const keep = [
            ...Object.keys(graph.files).map((f) => `${ASSETS_DIR}/${f}`),
            ...RUNTIME_PREFIXES.filter((p) => p !== `${ASSETS_DIR}/`).flatMap((prefix) =>
              listFiles(clientDir, prefix.replace(/\/$/, '')),
            ),
          ].sort();
          const script = cleanupScript(keep);
          const hash = createHash('sha256').update(script).digest('hex').slice(0, 10);
          const scriptName = `sw-engines-${hash}.js`;
          writeFileSync(path.join(clientDir, scriptName), script);

          final = { shell, importScripts: [scriptName] };
          await api.generateSW();
        },
      },
    };
  }

  return { precacheTransform, integration, finalize };
}
