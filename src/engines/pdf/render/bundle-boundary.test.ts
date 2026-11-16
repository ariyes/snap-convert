import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

/** Value (non-type) import/export-from specifiers. Dynamic import() is not matched. */
function staticImports(source: string): string[] {
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  return [...source.matchAll(pattern)].map((m) => m[1]!);
}

/** Every package reachable from `entry` through static imports within this folder. */
function staticPackages(entry: string): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of staticImports(read(file))) {
      if (spec.startsWith('./')) visit(`${spec.slice(2)}.ts`);
      else packages.add(spec);
    }
  };
  visit(entry);
  return packages;
}

// The build check (pdf.js absent from the entry chunk) is the real proof; this guards it in CI.
describe('startup bundle boundary', () => {
  it('reaches pdf.js from the public API only through dynamic import()', () => {
    const packages = [...staticPackages('index.ts')];
    expect(packages.filter((p) => p.startsWith('pdfjs-dist'))).toEqual([]);
    expect(read('documents.ts')).toContain("import('./pdfjs')");
  });

  it('keeps pdf.js imports in the lazily loaded module', () => {
    expect([...staticPackages('pdfjs.ts')].some((p) => p.startsWith('pdfjs-dist'))).toBe(true);
  });
});
