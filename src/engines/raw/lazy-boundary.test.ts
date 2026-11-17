// P29: the RAW engine and its decoders (FlashRaw ~3 MB of WebAssembly, LibRaw ~1 MB) load only
// for RAW files: never in the startup bundle, never for other images. Guards that nothing reaches
// them through a static import (the build keeps them in their own chunks; see the P29 report).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../..');

function staticImports(source: string): string[] {
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  return [...source.matchAll(pattern)].map((m) => m[1]!);
}

function resolveSource(fromFile: string, spec: string): string {
  const bare = spec.split('?')[0]!;
  const base = bare.startsWith('@/')
    ? join(srcRoot, bare.slice(2))
    : resolve(dirname(fromFile), bare);
  const found = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(
    (c) => existsSync(c) && statSync(c).isFile(),
  );
  if (!found) throw new Error(`Cannot resolve ${spec} from ${fromFile}`);
  return found;
}

/** Our source files and packages reachable from `entry` through static imports. */
function reachable(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.') || spec.startsWith('@/')) visit(resolveSource(file, spec));
      else packages.add(spec.split('?')[0]!);
    }
  };
  visit(entry);
  return { files, packages };
}

const DECODER_PACKAGES = ['flashraw', '@colorhythm/libraw-wasm'];
const usesDecoder = (packages: Set<string>) =>
  [...packages].some((p) => DECODER_PACKAGES.some((d) => p === d || p.startsWith(`${d}/`)));
const rawEngineFiles = (files: Set<string>) =>
  [...files].filter((f) => f.startsWith(here) && !f.endsWith('.test.ts'));

describe('RAW decoders load on demand', () => {
  it.each([
    ['the app (root route)', join(srcRoot, 'app/root.tsx')],
    ['the image worker', join(srcRoot, 'engines/image/worker.ts')],
    ['the image pipeline', join(srcRoot, 'engines/image/pipeline.ts')],
    ['decodeImage', join(srcRoot, 'engines/image/decode/index.ts')],
  ])('%s does not import the RAW engine or a RAW decoder statically', (_label, entry) => {
    const { files, packages } = reachable(entry);
    expect(rawEngineFiles(files)).toEqual([]);
    expect(usesDecoder(packages)).toBe(false);
  });

  it('decodeImage loads the RAW engine with import() in its RAW branch only', () => {
    const source = readFileSync(join(srcRoot, 'engines/image/decode/index.ts'), 'utf8');
    expect(source).toContain("await import('@/engines/raw')");
    expect(source).toMatch(/sniffKind\(head, nameOf\(file\)\) === 'raw'\) return decodeRawFile/);
  });

  it('the RAW engine itself only talks to its worker: no decoder code on the calling side', () => {
    const { packages } = reachable(join(here, 'index.ts'));
    expect(usesDecoder(packages)).toBe(false);
  });

  it('inside the RAW worker, FlashRaw and LibRaw are dynamic imports too', () => {
    const { files, packages } = reachable(join(here, 'raw.worker.ts'));
    // Static imports there are only the .wasm / worker URLs (`?url`), never the decoder code.
    expect(packages.has('flashraw')).toBe(false);
    expect(packages.has('@colorhythm/libraw-wasm')).toBe(false);
    expect(files.has(join(here, 'libraw.ts'))).toBe(false);
    expect(readFileSync(join(here, 'flashraw.ts'), 'utf8')).toContain("import('flashraw')");
    expect(readFileSync(join(here, 'engine.ts'), 'utf8')).toContain("import('./libraw')");
  });
});
