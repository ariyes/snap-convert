// Response headers for crkayes.com/snap-convert/ (P25), from docs/launch/headers.md (P24).
// One source for three users:
//   - deploy/csp.ts renders them into the nginx include that every location block uses,
//   - deploy/local-nginx.ts sends the same values when the smoke test runs against `pnpm preview`,
//   - deploy/smoke.ts checks the live site sends them.
// The caching and type rules below mirror deploy/nginx-snap-convert.conf (headers.test.ts checks
// that the two agree). Change both together.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const SITE_ORIGIN = 'https://crkayes.com';
export const BASE_PATH = '/snap-convert/';
export const LIVE_URL = `${SITE_ORIGIN}${BASE_PATH}`;

/** Placeholder in the nginx template; the server fills it with the script hashes (activate.sh). */
export const HASHES_PLACEHOLDER = '__SCRIPT_HASHES__';

export const CACHE_NO_CACHE = 'no-cache';
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';

/** Every header except the CSP, sent on every response (HTML, JS, wasm, workers, 404s). */
export const SECURITY_HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Embedder-Policy', 'credentialless'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  [
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  ],
  ['X-Frame-Options', 'SAMEORIGIN'],
];

export interface CspOptions {
  /** `'sha256-…'` sources for the inline scripts, or the placeholder. */
  scriptHashes: string[] | typeof HASHES_PLACEHOLDER;
  /** Extra origins for connect-src (only when the counter is not same-origin). */
  extraConnect?: string[];
}

/** The launch policy, one line, directives separated by "; " (same as e2e/csp.spec.ts). */
export function contentSecurityPolicy({ scriptHashes, extraConnect = [] }: CspOptions): string {
  const hashes = typeof scriptHashes === 'string' ? scriptHashes : scriptHashes.join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${hashes}`.trimEnd(),
    "worker-src 'self' blob:",
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    ['connect-src', "'self'", ...extraConnect].join(' '),
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

/** `'sha256-…'` of one inline script, as the browser computes it. */
export function scriptHash(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** Text of every inline script that runs (no src=, not JSON / JSON-LD data). */
export function inlineScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=|type="application\/(ld\+)?json"/.test(m[1] ?? '')) continue;
    scripts.push(m[2] ?? '');
  }
  return scripts;
}

/** Every HTML file of a build (skips assets/), relative paths with forward slashes. */
export function htmlFiles(buildDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const relName = rel ? `${rel}/${name}` : name;
      if (statSync(file).isDirectory()) {
        if (relName !== 'assets') walk(file, relName);
      } else if (name.endsWith('.html')) {
        out.push(relName);
      }
    }
  };
  walk(buildDir, '');
  return out;
}

/** Sorted, distinct hashes of every inline script in the build (same as e2e/csp.spec.ts). */
export function buildScriptHashes(buildDir: string): string[] {
  const hashes = new Set<string>();
  for (const rel of htmlFiles(buildDir)) {
    for (const text of inlineScripts(readFileSync(path.join(buildDir, rel), 'utf8'))) {
      hashes.add(scriptHash(text));
    }
  }
  return [...hashes].sort();
}

/** The `'sha256-…'` sources a CSP header allows in script-src. */
export function allowedScriptHashes(policy: string): Set<string> {
  const scriptSrc = policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('script-src '));
  return new Set((scriptSrc ?? '').split(/\s+/).filter((s) => s.startsWith("'sha256-")));
}

export interface PathRule {
  cacheControl: string;
  /** Set when nginx forces the type (types {} + default_type). */
  contentType?: string;
}

/**
 * What nginx-snap-convert.conf sends for a URL path (after try_files / error_page), apart from
 * the security headers that every location includes.
 */
export function pathRule(pathname: string): PathRule {
  const rel = pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname;
  if (rel.startsWith('assets/')) {
    if (rel.endsWith('.wasm'))
      return { cacheControl: CACHE_IMMUTABLE, contentType: 'application/wasm' };
    if (rel.endsWith('.mjs'))
      return { cacheControl: CACHE_IMMUTABLE, contentType: 'text/javascript' };
    return { cacheControl: CACHE_IMMUTABLE };
  }
  if (rel.startsWith('icons/') || rel.startsWith('og/')) return { cacheControl: CACHE_IMMUTABLE };
  if (rel === 'manifest.webmanifest') {
    return { cacheControl: CACHE_NO_CACHE, contentType: 'application/manifest+json' };
  }
  // HTML pages, *.data, sw.js, sitemap.xml, robots.txt, pwa-engines.json, samples, the 404 page.
  return { cacheControl: CACHE_NO_CACHE };
}
