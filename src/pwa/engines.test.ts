import { describe, expect, it } from 'vitest';
import type { EngineGraph } from './build-time/shell';
import {
  checkEngine,
  engineClosure,
  engineFor,
  formatMegabytes,
  pageIdFromPath,
  type EngineCheckDeps,
} from './engines';

const graph: EngineGraph = {
  version: 1,
  files: {
    'worker-A.js': { bytes: 4_000, refs: ['pipeline-B.js'] },
    'pipeline-B.js': { bytes: 46_000, refs: ['encode-C.js', 'worker-A.js'] },
    'encode-C.js': { bytes: 20_000, refs: ['mozjpeg-D.wasm'] },
    'mozjpeg-D.wasm': { bytes: 250_000, refs: [] },
    'pdf-E.js': { bytes: 440_000, refs: [] },
  },
};

const ASSETS = 'https://example.test/snap-convert/assets/';

function deps(cached: string[], g: EngineGraph | null = graph): EngineCheckDeps {
  const set = new Set(cached.map((f) => `${ASSETS}${f}`));
  return {
    assetsUrl: ASSETS,
    workerUrl: (kind) =>
      Promise.resolve(`/snap-convert/assets/${kind === 'image' ? 'worker-A.js' : 'pdf-E.js'}`),
    isCached: (url) => Promise.resolve(set.has(url)),
    loadGraph: () => Promise.resolve(g),
  };
}

describe('engineFor', () => {
  it('maps each phase 1 tool page to the worker it runs on', () => {
    expect(engineFor('compress-image')).toBe('image');
    expect(engineFor('heic-to-jpg')).toBe('image');
    expect(engineFor('png-to-jpg')).toBe('image');
    expect(engineFor('merge-pdf')).toBe('pdf');
    expect(engineFor('resize-pdf')).toBe('pdf');
    expect(engineFor('images-to-pdf')).toBe('pdf');
  });

  it('is null for the home page, other pages and coming-soon tools', () => {
    expect(engineFor(undefined)).toBeNull();
    expect(engineFor('privacy')).toBeNull();
    expect(engineFor('remove-background')).toBeNull();
    expect(engineFor('nope')).toBeNull();
  });

  it('reads the page id from a router path', () => {
    expect(pageIdFromPath('/compress-image')).toBe('compress-image');
    expect(pageIdFromPath('/compress-image/')).toBe('compress-image');
    expect(pageIdFromPath('/')).toBeUndefined();
  });
});

describe('engine files', () => {
  it('follows references, including cycles', () => {
    expect(engineClosure(graph, 'worker-A.js').sort()).toEqual([
      'encode-C.js',
      'mozjpeg-D.wasm',
      'pipeline-B.js',
      'worker-A.js',
    ]);
    expect(engineClosure(graph, 'missing.js')).toEqual([]);
  });

  it('formats sizes in MB with one decimal', () => {
    expect(formatMegabytes(2_100_000)).toBe('2.1 MB');
    expect(formatMegabytes(12_345_678)).toBe('12.3 MB');
    expect(formatMegabytes(4_000)).toBe('0.1 MB');
  });

  it('a cached worker means the tool has run here before', async () => {
    expect(await checkEngine('image', deps(['worker-A.js']))).toEqual({
      cached: true,
      missingBytes: 0,
    });
  });

  it('counts what is still missing for a tool that never ran', async () => {
    expect(await checkEngine('image', deps([]))).toEqual({ cached: false, missingBytes: 320_000 });
    // Files shared with a tool that did run are already there.
    expect(await checkEngine('image', deps(['mozjpeg-D.wasm']))).toEqual({
      cached: false,
      missingBytes: 70_000,
    });
    expect(await checkEngine('pdf', deps([]))).toEqual({ cached: false, missingBytes: 440_000 });
  });

  it('size unknown without the engine list', async () => {
    expect(await checkEngine('image', deps([], null))).toEqual({
      cached: false,
      missingBytes: null,
    });
  });
});
