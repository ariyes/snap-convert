import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { wasmPackages } from './vite.config.ts';

/** Real Chromium (via Playwright) for code that needs ImageData, canvas, workers and WebAssembly. */
const realChromium = {
  enabled: true,
  provider: playwright(),
  headless: true,
  screenshotFailures: false,
  instances: [{ browser: 'chromium' as const }],
};

const qualityTests = 'tests/quality/**/*.browser.test.ts';

// Separate from vite.config.ts on purpose: the React Router plugin must not run under Vitest.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    exclude: wasmPackages,
    // Pre-bundle the engines' lazily imported dependencies up front. Otherwise Vite discovers them
    // mid-run in a fresh checkout, reloads the browser and every running browser test fails.
    include: [
      'comlink',
      'exifr',
      'pica/pica_main',
      'libheif-js/libheif-wasm/libheif.js',
      'pdf-lib',
      'pdfjs-dist/legacy/build/pdf.mjs',
      'fflate',
      // Camera RAW decoders (P29). Their .wasm and thread-worker URLs are passed explicitly, so
      // pre-bundling them is safe.
      'flashraw',
      '@colorhythm/libraw-wasm',
    ],
  },
  worker: { format: 'es' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          exclude: ['**/*.browser.test.{ts,tsx}', '**/node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}', 'tests/**/*.browser.test.{ts,tsx}'],
          // The slow quality report runs only with `pnpm quality`.
          exclude: [qualityTests, '**/node_modules/**'],
          browser: realChromium,
        },
      },
      {
        // Same real-Chromium setup as `browser`, limited to the quality report (P12).
        extends: true,
        test: {
          name: 'quality',
          include: [qualityTests],
          browser: realChromium,
        },
      },
    ],
  },
});
