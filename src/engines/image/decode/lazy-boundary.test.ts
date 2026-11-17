// P12b: the canvas-free decoders (and fflate) load on demand, only in workers without
// OffscreenCanvas. Guards that nothing reaches them through a static import.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../../..');

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
      else packages.add(spec);
    }
  };
  visit(entry);
  return { files, packages };
}

const LAZY = ['fallback.ts', 'png.ts', 'gif.ts', 'bmp.ts'].map((f) => join(here, f));

describe('canvas-free decoders load on demand', () => {
  it.each([
    ['the image worker', join(srcRoot, 'engines/image/worker.ts')],
    ['the image pipeline', join(srcRoot, 'engines/image/pipeline.ts')],
    ['decodeImage', join(here, 'index.ts')],
  ])('%s does not import them statically', (_label, entry) => {
    const { files, packages } = reachable(entry);
    for (const lazy of LAZY) expect(files.has(lazy), lazy).toBe(false);
    expect(packages.has('fflate')).toBe(false);
    expect([...packages].some((p) => p.startsWith('@jsquash/'))).toBe(false);
  });

  it('decodeImage loads them with import()', () => {
    expect(readFileSync(join(here, 'index.ts'), 'utf8')).toContain("import('./fallback')");
    const fallback = readFileSync(join(here, 'fallback.ts'), 'utf8');
    for (const m of ["import('./png')", "import('./gif')", "import('./bmp')"]) {
      expect(fallback).toContain(m);
    }
  });
});
