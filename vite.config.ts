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

/**
 * Packages that load their own .wasm files via `new URL(..., import.meta.url)`.
 * Pre-bundling them breaks those URLs, so Vite must serve them as-is (jSquash docs).
 */
export const wasmPackages = ['@jsquash/avif', '@jsquash/jpeg', '@jsquash/oxipng', '@jsquash/webp'];

export default defineConfig({
  base: '/snap-convert/',
  plugins: [crossOriginIsolation(), tailwindcss(), reactRouter()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: { exclude: wasmPackages },
  // Module workers, so worker code can use dynamic import() for codecs.
  worker: { format: 'es' },
});
