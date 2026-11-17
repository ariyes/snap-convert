// Names shared by the build (service worker config) and the page (offline checks).
// Keep this file free of browser and Node code.

/**
 * Engine files (codecs, workers, WebAssembly, pdf.js data, lazy chunks), cached the first time a
 * tool uses them. File names carry a content hash, so an entry never goes stale; a new version
 * deletes the entries it no longer uses (see build-time/pwa-build.ts). Bump the suffix only if the
 * caching scheme itself changes.
 */
export const ENGINE_CACHE = 'snap-convert-engines-v1';

/** Paths under the app (relative to /snap-convert/) whose files are cached on first use. */
export const RUNTIME_PREFIXES = ['assets/', 'samples/'] as const;

/** Engine file list written next to the pages at build time (precached). */
export const ENGINE_GRAPH_FILE = 'pwa-engines.json';
