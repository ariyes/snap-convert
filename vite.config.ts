import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Connect, type Plugin } from 'vite';

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

export default defineConfig({
  base: '/snap-convert/',
  plugins: [crossOriginIsolation(), previewLikeNginx(), tailwindcss(), reactRouter()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: { exclude: wasmPackages },
  // Module workers, so worker code can use dynamic import() for codecs.
  worker: { format: 'es' },
});
