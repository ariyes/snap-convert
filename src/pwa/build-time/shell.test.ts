import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildEngineGraph, findShellAssets, isAppChunk, listPages, pageUrl } from './shell';

const BASE = '/snap-convert/';
let dir = '';

function write(rel: string, content: string | number): void {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'number' ? Buffer.alloc(content) : content);
}

// A miniature flattened build: two pages, the SPA fallback, shell scripts and engine files.
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'snap-pwa-'));
  const head = (route: string) =>
    `<link rel="modulepreload" href="${BASE}assets/entry-A1b2C3d4.js"/>` +
    `<link rel="modulepreload" href="${BASE}assets/${route}"/>` +
    `<link rel="stylesheet" href="${BASE}assets/root-Zz9Yy8Xx.css"/>`;
  write('index.html', `<html><head>${head('home-H0m3H0m3.js')}</head></html>`);
  write('compress-image/index.html', `<html><head>${head('route-R0ut3R0u.js')}</head></html>`);
  write('__spa-fallback.html', `<html><head>${head('home-H0m3H0m3.js')}</head></html>`);
  write('assets/entry-A1b2C3d4.js', 'import{a}from"./react-Re4ctRe4.js";');
  write('assets/react-Re4ctRe4.js', 'export const a=1;');
  write('assets/home-H0m3H0m3.js', 'import"./react-Re4ctRe4.js";');
  // The route loads the pipeline lazily and names the worker's URL: both are engine files.
  write(
    'assets/route-R0ut3R0u.js',
    'import{a}from"./react-Re4ctRe4.js";const w=()=>import("./pipeline-P1p3L1n3.js");const u="/snap-convert/assets/worker-W0rk3rW0.js";',
  );
  write('assets/root-Zz9Yy8Xx.css', `@font-face{src:url(${BASE}assets/geist-F0nTf0nT.woff2)}`);
  write('assets/geist-F0nTf0nT.woff2', 100);
  write('assets/worker-W0rk3rW0.js', 'import("./pipeline-P1p3L1n3.js")');
  write(
    'assets/pipeline-P1p3L1n3.js',
    'new URL("mozjpeg_enc-M0zJp3gX.wasm",import.meta.url);import("./avif-Av1fAv1f.js")',
  );
  write('assets/avif-Av1fAv1f.js', 'export{}');
  write('assets/mozjpeg_enc-M0zJp3gX.wasm', 250);
  write('assets/Adobe-Japan1-0-Cm4pCm4p.bcmap', 30);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('build: shell and engine files', () => {
  it('lists the pre-rendered pages', () => {
    expect(listPages(dir).sort()).toEqual([
      '__spa-fallback.html',
      'compress-image/index.html',
      'index.html',
    ]);
  });

  it('the shell is what pages load by themselves, with static imports and fonts', () => {
    expect([...findShellAssets(dir, BASE)].sort()).toEqual([
      'assets/entry-A1b2C3d4.js',
      'assets/geist-F0nTf0nT.woff2',
      'assets/home-H0m3H0m3.js',
      'assets/react-Re4ctRe4.js',
      'assets/root-Zz9Yy8Xx.css',
      'assets/route-R0ut3R0u.js',
    ]);
  });

  it('everything else is an engine file, with sizes and references', () => {
    const graph = buildEngineGraph(dir, findShellAssets(dir, BASE));
    const size = (rel: string) => statSync(path.join(dir, 'assets', rel)).size;
    expect(graph.files).toEqual({
      'worker-W0rk3rW0.js': { bytes: size('worker-W0rk3rW0.js'), refs: ['pipeline-P1p3L1n3.js'] },
      'pipeline-P1p3L1n3.js': {
        bytes: size('pipeline-P1p3L1n3.js'),
        refs: ['avif-Av1fAv1f.js', 'mozjpeg_enc-M0zJp3gX.wasm'],
      },
      'avif-Av1fAv1f.js': { bytes: size('avif-Av1fAv1f.js'), refs: [] },
      'mozjpeg_enc-M0zJp3gX.wasm': { bytes: 250, refs: [] },
      'Adobe-Japan1-0-Cm4pCm4p.bcmap': { bytes: 30, refs: [] },
    });
  });

  it('app chunks no page names join the shell (e.g. the not-found route)', () => {
    write('assets/not-found-N0tF0und.js', 'import"./react-Re4ctRe4.js";');
    const shell = findShellAssets(dir, BASE, ['assets/not-found-N0tF0und.js']);
    expect(shell.has('assets/not-found-N0tF0und.js')).toBe(true);
    expect(shell.has('assets/pipeline-P1p3L1n3.js')).toBe(false);
    rmSync(path.join(dir, 'assets/not-found-N0tF0und.js'));
  });

  it('app chunks are route modules and lazy app code, never engines or libraries', () => {
    const chunk = (id: string | null, isEntry = false, isDynamicEntry = true) => ({
      facadeModuleId: id,
      isEntry,
      isDynamicEntry,
    });
    expect(isAppChunk(chunk('C:\\app\\src\\app\\routes\\not-found.tsx', true, false))).toBe(true);
    expect(isAppChunk(chunk('/app/src/pwa/controller.tsx'))).toBe(true);
    expect(isAppChunk(chunk('/app/src/tools/compress-image/content.tsx'))).toBe(true);
    expect(isAppChunk(chunk('/app/src/engines/image/pipeline.ts'))).toBe(false);
    // The tiny module that only exports a worker's URL is app code; the worker itself is not.
    expect(isAppChunk(chunk('/app/src/engines/image/worker.ts?worker&url'))).toBe(true);
    expect(isAppChunk(chunk('/app/node_modules/pdfjs-dist/legacy/build/pdf.mjs'))).toBe(false);
    expect(isAppChunk(chunk('/app/src/ui/button.tsx', false, false))).toBe(false);
    expect(isAppChunk(chunk(null))).toBe(false);
  });

  it('pages are precached under the URLs the site links to', () => {
    expect(pageUrl('compress-image/index.html')).toBe('compress-image');
    expect(pageUrl('index.html')).toBe('index.html');
    expect(pageUrl('__spa-fallback.html')).toBe('__spa-fallback.html');
    expect(pageUrl('assets/x-12345678.js')).toBe('assets/x-12345678.js');
  });
});
