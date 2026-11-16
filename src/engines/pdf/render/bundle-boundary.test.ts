import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../../..');

/** Value (non-type) import/export-from specifiers. Dynamic import() is not matched. */
function staticImports(source: string): string[] {
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  return [...source.matchAll(pattern)].map((m) => m[1]!);
}

/** Resolves a relative or `@/` specifier to a source file (`x.ts`, `x.tsx` or `x/index.ts`). */
function resolveSource(fromFile: string, spec: string): string {
  const bare = spec.split('?')[0]!;
  const base = bare.startsWith('@/')
    ? join(srcRoot, bare.slice(2))
    : resolve(dirname(fromFile), bare);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  const found = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  if (!found) throw new Error(`Cannot resolve ${spec} from ${fromFile}`);
  return found;
}

/** Every package reachable from `entry` through static imports of our own source files. */
function staticPackages(entry: string): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.') || spec.startsWith('@/')) visit(resolveSource(file, spec));
      else packages.add(spec);
    }
  };
  visit(entry);
  return packages;
}

const usesPdfjs = (packages: Set<string>) => [...packages].some((p) => p.startsWith('pdfjs-dist'));

// The build check (pdf.js absent from the entry chunk) is the real proof; this guards it in CI.
describe('startup bundle boundary', () => {
  it('reaches pdf.js from the render API only through dynamic import()', () => {
    expect(usesPdfjs(staticPackages(join(here, 'index.ts')))).toBe(false);
    expect(readFileSync(join(here, 'documents.ts'), 'utf8')).toContain("import('./pdfjs')");
  });

  it('keeps pdf.js and pdf-lib out of the PDF engine entry (src/engines/pdf/index.ts)', () => {
    const packages = staticPackages(join(srcRoot, 'engines/pdf/index.ts'));
    expect(usesPdfjs(packages)).toBe(false);
    expect(packages.has('pdf-lib')).toBe(false);
  });

  it('keeps pdf.js imports in the lazily loaded module', () => {
    expect(usesPdfjs(staticPackages(join(here, 'pdfjs.ts')))).toBe(true);
  });
});
