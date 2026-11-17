// Checks a production build before it is deployed (P25), and lists its size.
//   - the files nginx and the service worker need are there,
//   - every page, asset and manifest path starts with /snap-convert/ (the app lives under it),
//   - canonical / og / sitemap URLs point at https://crkayes.com/snap-convert/, never localhost,
//   - no source maps are shipped.
//
//   node deploy/check-build.ts [build/client]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_PATH, LIVE_URL, SITE_ORIGIN } from './headers.ts';

export const REQUIRED_FILES = [
  'index.html',
  '__spa-fallback.html',
  'sw.js',
  'manifest.webmanifest',
  'sitemap.xml',
  'robots.txt',
  'pwa-engines.json',
  'third-party-licenses.txt',
];

export interface BuildFile {
  rel: string;
  bytes: number;
}

export function listFiles(dir: string): BuildFile[] {
  const out: BuildFile[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs).sort()) {
      const file = path.join(abs, name);
      const relName = rel ? `${rel}/${name}` : name;
      const stat = statSync(file);
      if (stat.isDirectory()) walk(file, relName);
      else out.push({ rel: relName, bytes: stat.size });
    }
  };
  walk(dir, '');
  return out;
}

const ext = (rel: string) => (path.extname(rel) || '(none)').toLowerCase();

/** Problems with root-relative paths in one HTML file. */
export function htmlPathProblems(rel: string, html: string): string[] {
  const problems: string[] = [];
  for (const m of html.matchAll(/\s(src|href|action|poster|content)="(\/[^"]*)"/g)) {
    const value = m[2] ?? '';
    if (!value.startsWith(BASE_PATH) || value.startsWith(`${BASE_PATH}${BASE_PATH.slice(1)}`)) {
      problems.push(`${rel}: ${m[1]}="${value}" is not under ${BASE_PATH}`);
    }
  }
  // URLs end at quotes, spaces, "<", ")" and "\" (JSON-escaped quotes in hydration data).
  for (const m of html.matchAll(/(?:https?:)?\/\/(?:localhost|127\.0\.0\.1)[^"'\s<\\]*/g)) {
    problems.push(`${rel}: points at ${m[0]}`);
  }
  for (const m of html.matchAll(/https:\/\/crkayes\.com\/[^"'\s<)\\]*/g)) {
    const url = m[0];
    if (url !== `${SITE_ORIGIN}/` && !url.startsWith(LIVE_URL)) {
      problems.push(`${rel}: ${url} is on crkayes.com but not under ${LIVE_URL}`);
    }
  }
  for (const m of html.matchAll(/<link rel="canonical" href="([^"]*)"/g)) {
    if (!(m[1] ?? '').startsWith(LIVE_URL)) problems.push(`${rel}: canonical ${m[1]}`);
  }
  return problems;
}

/** Root-relative URLs in CSS and JS that would miss the /snap-convert/ prefix. */
export function codePathProblems(rel: string, text: string): string[] {
  const problems: string[] = [];
  for (const m of text.matchAll(/url\(\s*["']?(\/[^)"']*)/g)) {
    if (!(m[1] ?? '').startsWith(BASE_PATH)) problems.push(`${rel}: url(${m[1]})`);
  }
  for (const m of text.matchAll(/["'`](\/(?:assets|icons|og|samples)\/[^"'`]*)/g)) {
    problems.push(`${rel}: "${m[1]}" is not under ${BASE_PATH}`);
  }
  return problems;
}

export function manifestProblems(text: string): string[] {
  const problems: string[] = [];
  const manifest = JSON.parse(text) as {
    start_url?: string;
    scope?: string;
    id?: string;
    icons?: Array<{ src?: string }>;
  };
  for (const key of ['start_url', 'scope', 'id'] as const) {
    if (!manifest[key]?.startsWith(BASE_PATH)) {
      problems.push(`manifest.webmanifest: ${key} is "${manifest[key]}"`);
    }
  }
  for (const icon of manifest.icons ?? []) {
    if (icon.src?.startsWith('/') && !icon.src.startsWith(BASE_PATH)) {
      problems.push(`manifest.webmanifest: icon ${icon.src}`);
    }
  }
  return problems;
}

export function sitemapProblems(text: string): string[] {
  const locs = [...text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1] ?? '');
  if (locs.length === 0) return ['sitemap.xml: no <loc> entries'];
  return locs.filter((u) => !u.startsWith(LIVE_URL)).map((u) => `sitemap.xml: ${u}`);
}

export interface BuildReport {
  files: BuildFile[];
  pages: string[];
  problems: string[];
}

export function checkBuild(buildDir: string): BuildReport {
  const files = listFiles(buildDir);
  const names = new Set(files.map((f) => f.rel));
  const problems: string[] = [];
  for (const file of REQUIRED_FILES) {
    if (!names.has(file)) problems.push(`missing ${file}`);
  }
  if (!files.some((f) => f.rel.startsWith('assets/') && f.rel.endsWith('.wasm'))) {
    problems.push('no .wasm files in assets/');
  }
  for (const f of files) {
    if (f.rel.endsWith('.map')) problems.push(`source map shipped: ${f.rel}`);
    if (f.rel.startsWith('snap-convert/')) problems.push(`page not flattened: ${f.rel}`);
    const read = () => readFileSync(path.join(buildDir, f.rel), 'utf8');
    if (f.rel.endsWith('.html')) problems.push(...htmlPathProblems(f.rel, read()));
    else if (/\.(?:css|m?js)$/.test(f.rel)) problems.push(...codePathProblems(f.rel, read()));
    else if (f.rel === 'manifest.webmanifest') problems.push(...manifestProblems(read()));
    else if (f.rel === 'sitemap.xml') problems.push(...sitemapProblems(read()));
  }
  const pages = files
    .filter((f) => f.rel === 'index.html' || /^[^/]+\/index\.html$/.test(f.rel))
    .map((f) => (f.rel === 'index.html' ? '' : f.rel.slice(0, -'/index.html'.length)));
  return { files, pages, problems };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

export function sizeReport({ files, pages }: BuildReport): string {
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  const byExt = new Map<string, { count: number; bytes: number }>();
  for (const f of files) {
    const e = byExt.get(ext(f.rel)) ?? { count: 0, bytes: 0 };
    e.count += 1;
    e.bytes += f.bytes;
    byExt.set(ext(f.rel), e);
  }
  const lines = [
    `Build: ${files.length} files, ${formatBytes(total)}, ${pages.length} pages`,
    'By type:',
    ...[...byExt.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([e, v]) => `  ${e.padEnd(14)} ${String(v.count).padStart(4)}  ${formatBytes(v.bytes)}`),
    'Largest files (loaded only by the tool that needs them):',
    ...[...files]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8)
      .map((f) => `  ${formatBytes(f.bytes).padStart(10)}  ${f.rel}`),
  ];
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const buildDir = path.resolve(process.argv[2] ?? path.join(root, 'build/client'));
  const report = checkBuild(buildDir);
  process.stdout.write(`${sizeReport(report)}\n`);
  if (report.problems.length > 0) {
    process.stderr.write(
      `\nBuild check failed:\n${report.problems.map((p) => `  - ${p}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`Build check passed: every path is under ${BASE_PATH}\n`);
}
