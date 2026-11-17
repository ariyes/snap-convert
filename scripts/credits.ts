/**
 * Open-source credits (P23), collected at build time from what is actually installed.
 *
 * - Every production dependency, direct and indirect, is found by walking `dependencies` and
 *   `optionalDependencies` from the root package.json through node_modules (pnpm or npm layout).
 *   For each one we read its package.json (name, version, license) and its license and notice files.
 * - Code that ships inside those packages but has no package of its own (the WebAssembly codecs,
 *   pdf.js's CMaps, fonts and decoders, polyfills) is listed by hand in COMPONENTS, with the
 *   license files the packages include, or a link to the upstream license when they include none.
 * - A few build tools put their own code into the built files; they are listed in BUILD_TOOLS.
 *
 * The credits page's `loader` (src/pages/credits.tsx) calls `collectCredits()`. React Router runs
 * loaders while pre-rendering, so the page is static HTML and none of this reaches the browser bundle.
 *
 * `node scripts/credits.ts` prints the list.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface PackageCredit {
  name: string;
  version: string;
  /** SPDX expression from package.json (or `UNKNOWN`). */
  license: string;
  /** The package's page on npm, for this exact version. */
  url: string;
  /** Keys into `CreditsData.texts`: license file(s), then notice file(s). */
  texts: string[];
}

export interface ComponentCredit {
  name: string;
  /** What it does in Snap Convert. */
  role: string;
  license: string;
  /** Upstream project. */
  url: string;
  /** The npm package it ships inside, with the installed version (e.g. `@jsquash/jpeg 1.6.0`). */
  includedIn: string;
  texts: string[];
  /** Upstream license file, for components whose package doesn't include the license text. */
  licenseUrl?: string;
}

export interface CreditsData {
  /** Production dependencies, sorted by name (fonts are in `fonts`). */
  packages: PackageCredit[];
  /** Font packages. */
  fonts: PackageCredit[];
  components: ComponentCredit[];
  /** Build tools whose own code ends up in the built files. */
  buildTools: PackageCredit[];
  /** License and notice texts, de-duplicated, keyed by a short content hash. */
  texts: Record<string, string>;
}

/** In the production dependency tree but never part of the browser build. */
const EXCLUDED: ReadonlyArray<{ match: (name: string) => boolean; why: string }> = [
  {
    match: (name) => name === '@napi-rs/canvas' || name.startsWith('@napi-rs/canvas-'),
    why: 'Node.js-only canvas, an optional dependency of pdfjs-dist for servers',
  },
  { match: (name) => name.startsWith('@types/'), why: 'TypeScript type definitions, no code' },
];

/** Build tools (dev dependencies) whose own code is copied into the built files. Path = dependency chain. */
const BUILD_TOOLS: ReadonlyArray<{ chain: string[]; why: string }> = [
  { chain: ['vite'], why: 'module preload helper' },
  { chain: ['vite', 'rolldown'], why: 'bundler runtime helpers' },
  { chain: ['tailwindcss'], why: 'base styles in our stylesheet' },
  { chain: ['vite-plugin-pwa', 'workbox-build', 'workbox-precaching'], why: 'service worker (offline use)' },
  { chain: ['vite-plugin-pwa', 'workbox-build', 'workbox-routing'], why: 'service worker (offline use)' },
  { chain: ['vite-plugin-pwa', 'workbox-build', 'workbox-strategies'], why: 'service worker (offline use)' },
];

interface ComponentSpec {
  name: string;
  role: string;
  license: string;
  url: string;
  /** npm package it ships inside. */
  includedIn: string;
  /** License files, relative to node_modules (resolved through `includedIn`'s folder). */
  files?: string[];
  licenseUrl?: string;
}

/**
 * Code inside packages that has no package.json of its own. Checked against the files that ship
 * (the .wasm binaries name their libraries and versions); update when a package is upgraded.
 */
const COMPONENTS: readonly ComponentSpec[] = [
  {
    name: 'MozJPEG (with libjpeg-turbo)',
    role: 'JPEG encoder (WebAssembly)',
    license: 'IJG AND BSD-3-Clause AND Zlib',
    url: 'https://github.com/mozilla/mozjpeg',
    includedIn: '@jsquash/jpeg',
    files: ['codec/LICENSE.codec.md'],
  },
  {
    name: 'libwebp',
    role: 'WebP encoder (WebAssembly)',
    license: 'BSD-3-Clause',
    url: 'https://chromium.googlesource.com/webm/libwebp',
    includedIn: '@jsquash/webp',
    files: ['codec/LICENSE.codec.md'],
  },
  {
    name: 'libavif',
    role: 'AVIF encoder and decoder (WebAssembly)',
    license: 'BSD-2-Clause',
    url: 'https://github.com/AOMediaCodec/libavif',
    includedIn: '@jsquash/avif',
    licenseUrl: 'https://github.com/AOMediaCodec/libavif/blob/main/LICENSE',
  },
  {
    name: 'libaom (AV1 codec library)',
    role: 'AV1 encoding and decoding inside libavif',
    license: 'BSD-2-Clause',
    url: 'https://aomedia.googlesource.com/aom/',
    includedIn: '@jsquash/avif',
    licenseUrl: 'https://aomedia.googlesource.com/aom/+/refs/heads/main/LICENSE',
  },
  {
    name: 'libyuv',
    role: 'Colour conversion inside libavif',
    license: 'BSD-3-Clause',
    url: 'https://chromium.googlesource.com/libyuv/libyuv/',
    includedIn: '@jsquash/avif',
    licenseUrl: 'https://chromium.googlesource.com/libyuv/libyuv/+/refs/heads/main/LICENSE',
  },
  {
    name: 'libsharpyuv (part of libwebp)',
    role: 'Sharp colour conversion inside the AVIF encoder',
    license: 'BSD-3-Clause',
    url: 'https://chromium.googlesource.com/webm/libwebp',
    includedIn: '@jsquash/avif',
    licenseUrl: 'https://chromium.googlesource.com/webm/libwebp/+/refs/heads/main/COPYING',
  },
  {
    name: 'Oxipng',
    role: 'PNG optimiser (WebAssembly)',
    license: 'MIT',
    url: 'https://github.com/shssoichiro/oxipng',
    includedIn: '@jsquash/oxipng',
    files: ['codec/LICENSE.codec.md'],
  },
  {
    name: 'libdeflate',
    role: 'Compression inside Oxipng',
    license: 'MIT',
    url: 'https://github.com/ebiggers/libdeflate',
    includedIn: '@jsquash/oxipng',
    licenseUrl: 'https://github.com/ebiggers/libdeflate/blob/master/COPYING',
  },
  {
    name: 'Rust crates in Oxipng: libdeflater 1.20.0 (Apache-2.0), bitvec 1.0.1 (MIT), wyz 0.5.1 (MIT), indexmap 2.2.6 and hashbrown 0.14.5, rayon 1.10.0 and rayon-core 1.12.1, crossbeam-channel 0.5.13 and crossbeam-epoch 0.9.18, dlmalloc 0.2.6, wasm-bindgen and the Rust standard library (MIT OR Apache-2.0), wasm-bindgen-rayon (Apache-2.0)',
    role: 'Libraries compiled into the Oxipng WebAssembly',
    license: 'MIT OR Apache-2.0',
    url: 'https://crates.io/',
    includedIn: '@jsquash/oxipng',
    licenseUrl: 'https://crates.io/crates/oxipng/9.1.1/dependencies',
  },
  {
    name: 'libheif',
    role: 'HEIC/HEIF decoder (WebAssembly)',
    license: 'LGPL-3.0',
    url: 'https://github.com/strukturag/libheif',
    includedIn: 'libheif-js',
    files: ['libheif-wasm/LICENSE'],
  },
  {
    name: 'libde265',
    role: 'HEVC decoder inside libheif',
    license: 'LGPL-3.0-or-later',
    url: 'https://github.com/strukturag/libde265',
    includedIn: 'libheif-js',
    licenseUrl: 'https://github.com/strukturag/libde265/blob/master/COPYING',
  },
  {
    name: 'LibRaw 0.22.1',
    role: 'Camera RAW decoder (WebAssembly), used when FlashRaw can’t read a file',
    license: 'LGPL-2.1-only OR CDDL-1.0',
    url: 'https://www.libraw.org/',
    includedIn: '@colorhythm/libraw-wasm',
    files: ['LibRaw/COPYRIGHT', 'LibRaw/LICENSE.LGPL', 'LibRaw/LICENSE.CDDL'],
  },
  {
    name: 'Emscripten runtime',
    role: 'Glue code that starts the WebAssembly codecs',
    license: 'MIT OR NCSA',
    url: 'https://emscripten.org/',
    includedIn: '@jsquash/jpeg, @jsquash/webp, @jsquash/avif, libheif-js',
    licenseUrl: 'https://github.com/emscripten-core/emscripten/blob/main/LICENSE',
  },
  {
    name: 'Adobe CMap resources',
    role: 'Character maps for Chinese, Japanese and Korean text in PDFs',
    license: 'BSD-3-Clause',
    url: 'https://github.com/adobe-type-tools/cmap-resources',
    includedIn: 'pdfjs-dist',
    files: ['cmaps/LICENSE'],
  },
  {
    name: 'Foxit standard fonts (from PDFium)',
    role: 'Fallback fonts for PDFs that don’t embed their fonts',
    license: 'BSD-3-Clause',
    url: 'https://pdfium.googlesource.com/pdfium/',
    includedIn: 'pdfjs-dist',
    files: ['standard_fonts/LICENSE_FOXIT'],
  },
  {
    name: 'Liberation Sans fonts',
    role: 'Fallback fonts for PDFs that don’t embed their fonts',
    license: 'GPL-2.0 with font exception',
    url: 'https://github.com/liberationfonts/liberation-fonts',
    includedIn: 'pdfjs-dist',
    files: ['standard_fonts/LICENSE_LIBERATION'],
  },
  {
    name: 'OpenJPEG',
    role: 'JPEG 2000 image decoder for PDFs (WebAssembly)',
    license: 'BSD-2-Clause',
    url: 'https://github.com/uclouvain/openjpeg',
    includedIn: 'pdfjs-dist',
    files: ['wasm/LICENSE_OPENJPEG', 'wasm/LICENSE_PDFJS_OPENJPEG'],
  },
  {
    name: 'JBIG2 decoder (from PDFium)',
    role: 'JBIG2 image decoder for scanned PDFs (WebAssembly)',
    license: 'BSD-3-Clause AND Apache-2.0',
    url: 'https://pdfium.googlesource.com/pdfium/',
    includedIn: 'pdfjs-dist',
    files: ['wasm/LICENSE_JBIG2', 'wasm/LICENSE_PDFJS_JBIG2'],
  },
  {
    name: 'core-js 3.51.0',
    role: 'JavaScript polyfills inside pdf.js’s compatibility build',
    license: 'MIT',
    url: 'https://github.com/zloirock/core-js',
    includedIn: 'pdfjs-dist',
    licenseUrl: 'https://github.com/zloirock/core-js/blob/v3.51.0/LICENSE',
  },
];

const LICENSE_FILE = /^(licen[cs]e|copying)([-_.].*)?$/i;
const NOTICE_FILE = /^notice(\..*)?$/i;

interface FoundPackage {
  dir: string;
  json: Record<string, unknown>;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Node's lookup: `<dir>/node_modules/<name>`, walking up from `fromDir` to `rootDir`. pnpm keeps a
 * package's dependencies next to it in its store folder, so the first match is the right version.
 * pnpm's hidden hoisting folder (node_modules/.pnpm/node_modules) is skipped: it can hold packages
 * that aren't really dependencies (e.g. optional ones for other platforms).
 */
function findPackageDir(name: string, fromDir: string, rootDir: string): string | undefined {
  const hidden = path.join(rootDir, 'node_modules', '.pnpm');
  let dir = fromDir;
  for (;;) {
    if (dir !== hidden) {
      const candidate = path.join(dir, 'node_modules', ...name.split('/'));
      if (isFile(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    }
    if (dir === rootDir) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function dependencyNames(json: Record<string, unknown>): { name: string; optional: boolean }[] {
  const names = (field: string) => {
    const value = json[field];
    return value && typeof value === 'object' ? Object.keys(value) : [];
  };
  const optional = new Set(names('optionalDependencies'));
  return [...new Set([...names('dependencies'), ...optional])].map((name) => ({
    name,
    optional: optional.has(name),
  }));
}

/** SPDX expression from `license`, or the legacy `licenses` array. */
export function licenseOf(json: Record<string, unknown>): string {
  const typeOf = (value: unknown): string | undefined =>
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'type' in value && typeof value.type === 'string'
        ? value.type
        : undefined;
  const single = typeOf(json.license);
  if (single) return single;
  if (Array.isArray(json.licenses)) {
    const all = json.licenses.map(typeOf).filter((t): t is string => !!t);
    if (all.length) return all.length === 1 ? all[0]! : `(${all.join(' OR ')})`;
  }
  return 'UNKNOWN';
}

class TextStore {
  readonly texts: Record<string, string> = {};

  add(text: string): string {
    const normalised = text.replace(/\r\n?/g, '\n').trim();
    const id = createHash('sha256').update(normalised).digest('hex').slice(0, 12);
    this.texts[id] = normalised;
    return id;
  }

  addFiles(files: string[]): string[] {
    return files.map((file) => this.add(readFileSync(file, 'utf8')));
  }
}

/** License files first, then notice files (Apache-2.0 asks for NOTICE files to be passed on). */
function licenseFiles(dir: string): string[] {
  const entries = readdirSync(dir).filter((f) => isFile(path.join(dir, f)));
  const licenses = entries.filter((f) => LICENSE_FILE.test(f)).sort();
  const notices = entries.filter((f) => NOTICE_FILE.test(f)).sort();
  return [...licenses, ...notices].map((f) => path.join(dir, f));
}

function packageCredit(found: FoundPackage, store: TextStore): PackageCredit {
  const name = String(found.json.name);
  const version = String(found.json.version);
  return {
    name,
    version,
    license: licenseOf(found.json),
    url: `https://www.npmjs.com/package/${name}/v/${version}`,
    texts: store.addFiles(licenseFiles(found.dir)),
  };
}

function byName(a: PackageCredit, b: PackageCredit): number {
  return a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en');
}

/** Every installed production dependency (direct and indirect), minus EXCLUDED. */
export function collectProductionPackages(rootDir: string): FoundPackage[] {
  const root = readJson(path.join(rootDir, 'package.json'));
  const seen = new Map<string, FoundPackage>();
  const queue: { name: string; optional: boolean; from: string }[] = dependencyNames(root).map(
    (d) => ({ ...d, from: rootDir }),
  );
  while (queue.length) {
    const { name, optional, from } = queue.shift()!;
    if (EXCLUDED.some((e) => e.match(name))) continue;
    const dir = findPackageDir(name, from, rootDir);
    if (!dir) {
      if (optional) continue; // optional dependency not installed on this platform
      throw new Error(`credits: dependency "${name}" (needed by ${from}) is not installed`);
    }
    if ([...seen.values()].some((p) => p.dir === dir)) continue;
    const json = readJson(path.join(dir, 'package.json'));
    const found = { dir, json };
    seen.set(`${String(json.name)}@${String(json.version)}`, found);
    for (const dep of dependencyNames(json)) queue.push({ ...dep, from: dir });
  }
  return [...seen.values()];
}

/** Everything the credits page shows. `rootDir` is the project folder (where package.json is). */
export function collectCredits(rootDir: string = process.cwd()): CreditsData {
  const store = new TextStore();
  const installed = collectProductionPackages(rootDir);
  const credits = installed.map((p) => packageCredit(p, store)).sort(byName);
  const isFont = (p: PackageCredit) => p.name.startsWith('@fontsource');

  const dirOf = new Map(installed.map((p) => [String(p.json.name), p.dir]));
  const versionOf = new Map(credits.map((p) => [p.name, p.version]));

  const components = COMPONENTS.map((spec): ComponentCredit => {
    const hosts = spec.includedIn.split(', ');
    const hostDir = dirOf.get(hosts[0]!);
    if (!hostDir)
      throw new Error(`credits: ${spec.name} ships in ${hosts[0]}, which isn't installed`);
    const files = (spec.files ?? []).map((f) => path.join(hostDir, f));
    for (const file of files) {
      if (!isFile(file)) throw new Error(`credits: license file missing for ${spec.name}: ${file}`);
    }
    return {
      name: spec.name,
      role: spec.role,
      license: spec.license,
      url: spec.url,
      includedIn: hosts.map((h) => `${h} ${versionOf.get(h) ?? ''}`.trim()).join(', '),
      texts: store.addFiles(files),
      ...(spec.licenseUrl ? { licenseUrl: spec.licenseUrl } : {}),
    };
  });

  const buildTools = BUILD_TOOLS.map(({ chain }) => {
    let dir: string | undefined = rootDir;
    for (const name of chain) {
      dir = dir && findPackageDir(name, dir, rootDir);
    }
    if (!dir) throw new Error(`credits: build tool ${chain.join(' → ')} is not installed`);
    return packageCredit({ dir, json: readJson(path.join(dir, 'package.json')) }, store);
  }).sort(byName);

  return {
    packages: credits.filter((p) => !isFont(p)),
    fonts: credits.filter(isFont),
    components,
    buildTools,
    texts: store.texts,
  };
}

/** The page needs names, versions and links only; the full texts go in the plain-text file. */
export type CreditsSummary = Omit<CreditsData, 'texts'>;

export function summarizeCredits(data: CreditsData): CreditsSummary {
  const { texts: _texts, ...summary } = data;
  return summary;
}

/** Published next to the pages: every license and notice text, each written out once. */
export const LICENSES_FILE = 'third-party-licenses.txt';

/** Plain-text file with every license and notice text (linked from the credits page). */
export function thirdPartyLicensesText(data: CreditsData): string {
  const rule = '='.repeat(78);
  const written = new Map<string, string>();
  const out: string[] = [
    'Snap Convert — third-party licenses',
    '',
    'Snap Convert is free software under the GNU Affero General Public License, version 3',
    '(AGPL-3.0-only). This file lists the open-source software included in the built',
    'web app and the full text of each license and notice, as the licenses require.',
    'Generated at build time from the installed packages (scripts/credits.ts).',
  ];
  const entry = (title: string, details: string[], textIds: string[], licenseUrl?: string) => {
    out.push('', rule, title, ...details);
    if (licenseUrl) out.push(`License text: ${licenseUrl}`);
    if (!textIds.length && !licenseUrl) out.push('(The package includes no license file.)');
    for (const id of textIds) {
      const first = written.get(id);
      if (first) {
        out.push(`License text: same as ${first} above.`);
      } else {
        written.set(id, title);
        out.push('', data.texts[id] ?? '');
      }
    }
  };
  const pkg = (p: PackageCredit) =>
    entry(`${p.name} ${p.version}`, [`License: ${p.license}`, p.url], p.texts);

  out.push('', '', '## Libraries');
  data.packages.forEach(pkg);
  out.push('', '', '## Fonts');
  data.fonts.forEach(pkg);
  out.push('', '', '## Code included inside the packages above');
  for (const c of data.components) {
    entry(
      c.name,
      [`${c.role}. License: ${c.license}`, `Included in: ${c.includedIn}`, c.url],
      c.texts,
      c.licenseUrl,
    );
  }
  out.push('', '', '## Build tools whose code is included in the built files');
  data.buildTools.forEach(pkg);
  return `${out.join('\n')}\n`;
}

/** Build hook (react-router.config.ts `buildEnd`): writes LICENSES_FILE into the client folder. */
export async function writeThirdPartyLicenses(
  clientDir: string,
  rootDir: string = process.cwd(),
): Promise<void> {
  await writeFile(
    path.join(clientDir, LICENSES_FILE),
    thirdPartyLicensesText(collectCredits(rootDir)),
  );
}

if (import.meta.main) {
  const data = collectCredits(existsSync('package.json') ? process.cwd() : path.resolve('..'));
  const line = (p: PackageCredit) => `${p.name}@${p.version}  ${p.license}`;
  console.warn(`Packages (${data.packages.length}):\n${data.packages.map(line).join('\n')}`);
  console.warn(`\nFonts:\n${data.fonts.map(line).join('\n')}`);
  console.warn(`\nBuild tools:\n${data.buildTools.map(line).join('\n')}`);
  console.warn(
    `\nComponents:\n${data.components.map((c) => `${c.name}  ${c.license}  (${c.includedIn})`).join('\n')}`,
  );
  const size = Object.values(data.texts).reduce((n, t) => n + t.length, 0);
  console.warn(`\n${Object.keys(data.texts).length} license texts, ${size} characters`);
}
