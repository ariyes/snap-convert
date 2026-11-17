import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_BASE, ICONS, MANIFEST_FILENAME } from './src/pwa/brand.ts';
import { createPwaBuild } from './src/pwa/build-time/pwa-build.ts';
import { ENGINE_CACHE, ENGINE_GRAPH_FILE, RUNTIME_PREFIXES } from './src/pwa/cache-names.ts';
import { webManifest } from './src/pwa/manifest.ts';

/** Needed for multi-threaded WebAssembly (SharedArrayBuffer). Production sets the same in nginx. */
export const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

/**
 * Sends the headers on every dev and preview response. Vite's `server.headers` alone misses
 * the HTML pages that React Router's dev middleware renders, so a middleware sets them first.
 */
function crossOriginIsolation(): Plugin {
  const setHeaders: Connect.NextHandleFunction = (_req, res, next) => {
    for (const [name, value] of Object.entries(crossOriginIsolationHeaders)) {
      res.setHeader(name, value);
    }
    next();
  };
  return {
    name: 'snap-convert:cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use(setHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(setHeaders);
    },
  };
}

/** React Router's SPA shell for unknown URLs (renamed by scripts/flatten-prerender.ts). */
const SPA_FALLBACK = '__spa-fallback.html';

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * `vite preview` only: answers like production nginx
 * (`try_files $uri $uri/index.html $uri.html /snap-convert/__spa-fallback.html`), so end-to-end
 * tests see what users will. `/snap-convert/png-to-jpg` serves `png-to-jpg/index.html`, and an
 * unknown path gets the SPA fallback with status 404. Runs after the cross-origin-isolation
 * middleware, so those headers are on every response, 404s included.
 */
function previewLikeNginx(): Plugin {
  return {
    name: 'snap-convert:preview-like-nginx',
    configurePreviewServer(server) {
      const { config } = server;
      const base = config.base; // "/snap-convert/"
      const outDir = path.resolve(config.root, config.environments.client?.build.outDir ?? 'dist');

      server.middlewares.use((req, res, next) => {
        // React Router's pre-render step also starts a preview server; leave its requests alone.
        if (process.env.IS_RR_BUILD_REQUEST === 'yes') return next();
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !req.url) return next();
        const url = new URL(req.url, 'http://preview.local');
        if (!url.pathname.startsWith(base)) return next();

        let rel: string;
        try {
          rel = decodeURIComponent(url.pathname.slice(base.length));
        } catch {
          return next();
        }
        const target = path.resolve(outDir, rel);
        // Never look outside the build folder ("/snap-convert/../x").
        if (target !== outDir && !target.startsWith(outDir + path.sep)) return next();

        // $uri: a real file is served as it is.
        if (isFile(target)) return next();
        // $uri/index.html, then $uri.html.
        const trimmed = url.pathname.replace(/\/+$/, '');
        for (const [file, servedAs] of [
          [path.join(target, 'index.html'), `${trimmed}/index.html`],
          [`${target}.html`, `${trimmed}.html`],
        ] as const) {
          if (isFile(file)) {
            req.url = servedAs + url.search;
            return next();
          }
        }
        // Fallback: the SPA shell renders the not-found page; the status says so too.
        const fallback = path.join(outDir, SPA_FALLBACK);
        if (!isFile(fallback)) return next();
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(req.method === 'HEAD' ? undefined : readFileSync(fallback));
      });
    },
  };
}

/**
 * Packages that load their own .wasm files via `new URL(..., import.meta.url)`.
 * Pre-bundling them breaks those URLs, so Vite must serve them as-is (jSquash docs).
 */
export const wasmPackages = ['@jsquash/avif', '@jsquash/jpeg', '@jsquash/oxipng', '@jsquash/webp'];

// PWA (P21): installable app + offline. The service worker precaches the shell (every page, its
// scripts, styles, fonts, icons) and caches engine files (codecs, WebAssembly, pdf.js, pdf-lib,
// libheif, lazy chunks) the first time a tool uses them. See src/pwa/build-time/pwa-build.ts.
const pwaBuild = createPwaBuild({ outDir: 'build/client' });
const pwa = [
  ...VitePWA({
    base: APP_BASE,
    scope: APP_BASE,
    outDir: 'build/client',
    filename: 'sw.js',
    registerType: 'prompt',
    // Registered from src/pwa after hydration (lazy chunk), never by an injected script.
    injectRegister: false,
    manifestFilename: MANIFEST_FILENAME,
    manifest: webManifest,
    includeAssets: [ICONS.apple],
    integration: pwaBuild.integration,
    workbox: {
      globPatterns: ['**/*.html', 'assets/**/*.{js,css,woff2}', ENGINE_GRAPH_FILE],
      manifestTransforms: [pwaBuild.precacheTransform],
      // Unknown URLs get React Router's SPA shell (its not-found page), as nginx does.
      navigateFallback: '__spa-fallback.html',
      navigateFallbackAllowlist: [new RegExp(`^${APP_BASE}`)],
      // Direct links to files (samples, manifest, …) are not pages.
      navigateFallbackDenylist: [/\/[^/?]+\.[^/?]+$/],
      // Take control of the first visit at once, so a tool used then is cached for offline.
      clientsClaim: true,
      // Updates wait for the user's "Refresh" (never mid-job).
      skipWaiting: false,
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          urlPattern: new RegExp(`${APP_BASE}(?:${RUNTIME_PREFIXES.join('|')})`),
          handler: 'CacheFirst',
          options: { cacheName: ENGINE_CACHE, cacheableResponse: { statuses: [200] } },
        },
      ],
    },
  }),
  pwaBuild.finalize(),
];

export default defineConfig({
  base: '/snap-convert/',
  plugins: [crossOriginIsolation(), previewLikeNginx(), tailwindcss(), reactRouter(), ...pwa],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: { exclude: wasmPackages },
  // Module workers, so worker code can use dynamic import() for codecs.
  worker: { format: 'es' },
});
