// Build-time (Node) helpers: which built files are the app shell (precached) and which are engine
// files (cached by the service worker only once a tool has used them).
//
// The shell is everything a pre-rendered page loads by itself: its HTML, the scripts and module
// preloads it names, their static imports, the stylesheets and the fonts those use. Everything
// else in assets/ (codecs, workers, WebAssembly, pdf.js and its CMaps/fonts, pdf-lib, libheif and
// lazily imported chunks) is an engine file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const ASSETS_DIR = 'assets';

/** Every file under `dir/sub`, as forward-slash paths relative to `dir` ("assets/x.js"). */
export function listFiles(dir: string, sub = ''): string[] {
  const out: string[] = [];
  if (!existsSync(path.join(dir, sub))) return out;
  for (const name of readdirSync(path.join(dir, sub))) {
    const rel = sub ? `${sub}/${name}` : name;
    if (statSync(path.join(dir, rel)).isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out;
}

/** Pre-rendered pages, e.g. `index.html`, `compress-image/index.html`, `__spa-fallback.html`. */
export function listPages(clientDir: string): string[] {
  return listFiles(clientDir).filter((f) => f.endsWith('.html') && !f.startsWith(`${ASSETS_DIR}/`));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Asset paths (`assets/x.js`) named anywhere in `text` as `<base>assets/…` or `./x.ext`. */
function referencedAssets(text: string, base: string, from: string, known: Set<string>): string[] {
  const found = new Set<string>();
  const absolute = new RegExp(`${escapeRegExp(base)}(${ASSETS_DIR}/[^"'\`)\\s?#]+)`, 'g');
  for (const m of text.matchAll(absolute)) if (m[1] && known.has(m[1])) found.add(m[1]);
  // Relative references between files in assets/ ("./x.js", "x.woff2", `new URL("x.wasm", …)`).
  if (from.startsWith(`${ASSETS_DIR}/`)) {
    for (const m of text.matchAll(/["'`(]\.?\/?([\w.~-]+\.[a-z0-9]+)["'`)?#]/gi)) {
      const rel = `${ASSETS_DIR}/${m[1]}`;
      if (m[1] && known.has(rel) && rel !== from) found.add(rel);
    }
  }
  return [...found];
}

/** Static imports (`import … from "./x.js"`, `import "./x.js"`) of a built JS module. */
function staticImports(code: string, from: string, known: Set<string>): string[] {
  const dir = path.posix.dirname(from);
  const out: string[] = [];
  for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    if (!m[1]) continue;
    const rel = path.posix.normalize(path.posix.join(dir, m[1]));
    if (known.has(rel)) out.push(rel);
  }
  return out;
}

/**
 * Chunks of the client build that belong to the app rather than to an engine: entry chunks
 * (React Router route modules, e.g. the not-found page that only the SPA fallback loads) and
 * lazily imported app code (e.g. the service worker controller, tool content). Engine code
 * (src/engines/, libraries from node_modules) and worker bundles are left out.
 */
export function isAppChunk(chunk: {
  isEntry: boolean;
  isDynamicEntry: boolean;
  facadeModuleId: string | null;
}): boolean {
  if (chunk.isEntry) return true;
  if (!chunk.isDynamicEntry || !chunk.facadeModuleId) return false;
  const [id = '', query = ''] = chunk.facadeModuleId.replace(/\\/g, '/').split('?');
  // `?worker&url` modules only hold a worker's URL (a few bytes); the queue and the offline
  // check need them to know which file to start or look for.
  if (/(^|&)worker(&|$)/.test(query) && /(^|&)url(&|$)/.test(query)) return true;
  return id.includes('/src/') && !id.includes('/src/engines/') && !id.includes('/node_modules/');
}

/**
 * Shell assets: what the pre-rendered pages reference (scripts, module preloads, stylesheets),
 * `appChunks` (see isAppChunk), the static imports of those scripts, and the files their
 * stylesheets use (fonts).
 */
export function findShellAssets(
  clientDir: string,
  base: string,
  appChunks: Iterable<string> = [],
): Set<string> {
  const known = new Set(listFiles(clientDir, ASSETS_DIR));
  const shell = new Set<string>();
  const queue: string[] = [];
  const add = (f: string) => {
    if (shell.has(f)) return;
    shell.add(f);
    queue.push(f);
  };
  for (const chunk of appChunks) if (known.has(chunk)) add(chunk);
  for (const page of listPages(clientDir)) {
    const html = readFileSync(path.join(clientDir, page), 'utf8');
    referencedAssets(html, base, page, known).forEach(add);
  }
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (file.endsWith('.css')) {
      const css = readFileSync(path.join(clientDir, file), 'utf8');
      referencedAssets(css, base, file, known).forEach(add);
    } else if (/\.m?js$/.test(file)) {
      const code = readFileSync(path.join(clientDir, file), 'utf8');
      staticImports(code, file, known).forEach(add);
    }
  }
  return shell;
}

export interface EngineFile {
  bytes: number;
  /** Other engine files this one loads (dynamic imports, workers, WebAssembly, data files). */
  refs: string[];
}

/** Engine files list: name in assets/ → size and the engine files it refers to. */
export interface EngineGraph {
  version: 1;
  files: Record<string, EngineFile>;
}

/** Every non-shell file in assets/, with its size and which other engine files it names. */
export function buildEngineGraph(clientDir: string, shell: Set<string>): EngineGraph {
  const engine = listFiles(clientDir, ASSETS_DIR).filter((f) => !shell.has(f));
  const engineSet = new Set(engine);
  const names = engine.map((f) => f.slice(ASSETS_DIR.length + 1));
  const nameRe = new RegExp(names.map(escapeRegExp).join('|'), 'g');
  const files: Record<string, EngineFile> = {};
  for (const file of engine) {
    const name = file.slice(ASSETS_DIR.length + 1);
    const full = path.join(clientDir, file);
    const refs = new Set<string>();
    if (/\.m?js$/.test(file) && names.length > 0) {
      const code = readFileSync(full, 'utf8');
      for (const m of code.matchAll(nameRe)) {
        if (m[0] !== name && engineSet.has(`${ASSETS_DIR}/${m[0]}`)) refs.add(m[0]);
      }
    }
    files[name] = { bytes: statSync(full).size, refs: [...refs].sort() };
  }
  return { version: 1, files };
}

/** `compress-image/index.html` → `compress-image` (the URL the site links to); others unchanged. */
export function pageUrl(file: string): string {
  if (file === 'index.html') return file;
  return file.endsWith('/index.html') ? file.slice(0, -'/index.html'.length) : file;
}
