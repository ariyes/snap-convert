// Post-deploy smoke test (P25), Playwright in Chromium and WebKit.
//
//   node deploy/smoke.ts                                        local: the production build in
//        build/client, served by `vite preview` (port 5480) behind deploy/local-nginx.ts (port 4480),
//        which sends the nginx headers with this build's CSP
//   node deploy/smoke.ts --url https://crkayes.com/snap-convert/   the live site, after a deploy
//
// Options: --browsers chromium,webkit (default both)   --port 4480   --upstream-port 5480
//
// Checks:
//   - every page returns 200 with COOP, COEP, the other security headers and a CSP that allows
//     every inline script of that page (a stale CSP include would break hydration)
//   - /snap-convert → /snap-convert/, unknown URLs → 404 with the not-found page and the headers
//   - assets: long cache + headers; .wasm as application/wasm; .mjs as JavaScript; sw.js and
//     HTML no-cache; manifest as application/manifest+json; compression on the live site
//   - in each browser: the home page hydrates; a sample compress and a sample merge succeed;
//     no console error, no page error, no CSP violation, no request to another site
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, webkit, type BrowserType, type Page } from 'playwright';
import { checkBuild } from './check-build.ts';
import { headersTemplate, renderHeaders, REPO_ROOT, templateOptionsFromEnv } from './csp.ts';
import {
  allowedScriptHashes,
  buildScriptHashes,
  CACHE_IMMUTABLE,
  CACHE_NO_CACHE,
  inlineScripts,
  scriptHash,
  SECURITY_HEADERS,
} from './headers.ts';
import { startLocalNginx, startPreview } from './local-nginx.ts';

const BUILD = path.join(REPO_ROOT, 'build/client');

interface Result {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Result[] = [];
const say = (line = '') => process.stdout.write(`${line}\n`);

function record(name: string, problems: string[]): void {
  const ok = problems.length === 0;
  results.push({ name, ok, detail: problems.join('; ') });
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${problems.join('\n      ')}`}`);
}

async function get(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(30_000) });
}

/** Problems with the headers every Snap Convert response must carry. */
function securityProblems(res: Response, cspName: string): string[] {
  const problems: string[] = [];
  for (const [name, value] of SECURITY_HEADERS) {
    const got = res.headers.get(name);
    if (got !== value) problems.push(`${name}: ${got ?? 'missing'}`);
  }
  if (!res.headers.get(cspName)) problems.push(`${cspName} missing`);
  return problems;
}

function expectHeader(res: Response, name: string, test: (v: string) => boolean, want: string) {
  const got = res.headers.get(name);
  return got !== null && test(got) ? [] : [`${name}: ${got ?? 'missing'} (want ${want})`];
}

/** Pages to visit: from the local build, or the live sitemap when there is no build. */
async function pageList(base: string): Promise<string[]> {
  if (existsSync(path.join(BUILD, 'index.html'))) return checkBuild(BUILD).pages;
  const sitemap = await (await get(`${base}sitemap.xml`)).text();
  return [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => (m[1] ?? '').slice(base.length));
}

async function httpChecks(base: string, live: boolean, cspName: string): Promise<void> {
  const origin = new URL(base).origin;
  const pages = await pageList(base);

  // Pages: 200, HTML, headers, no-cache, CSP covers the page's own inline scripts.
  const pageProblems: string[] = [];
  let homeHtml = '';
  for (const page of pages) {
    const url = `${base}${page}`;
    const res = await get(url);
    const html = await res.text();
    if (page === '') homeHtml = html;
    const problems = [
      ...(res.status === 200 ? [] : [`status ${res.status}`]),
      ...expectHeader(res, 'content-type', (v) => v.startsWith('text/html'), 'text/html'),
      ...expectHeader(res, 'cache-control', (v) => v === CACHE_NO_CACHE, CACHE_NO_CACHE),
      ...securityProblems(res, cspName),
    ];
    const allowed = allowedScriptHashes(res.headers.get(cspName) ?? '');
    const blocked = inlineScripts(html).filter((s) => !allowed.has(scriptHash(s)));
    if (blocked.length > 0)
      problems.push(`${blocked.length} inline script(s) not allowed by the CSP`);
    for (const p of problems) pageProblems.push(`/${page}: ${p}`);
  }
  record(
    `${pages.length} pages: 200, security headers, CSP matches the inline scripts`,
    pageProblems,
  );

  const noSlash = await get(base.replace(/\/$/, ''));
  record('/snap-convert redirects to /snap-convert/', [
    ...(noSlash.status === 301 || noSlash.status === 308 ? [] : [`status ${noSlash.status}`]),
    ...expectHeader(
      noSlash,
      'location',
      (v) => new URL(v, origin).pathname === new URL(base).pathname,
      new URL(base).pathname,
    ),
  ]);

  const missing = await get(`${base}this-page-does-not-exist`);
  const missingHtml = await missing.text();
  record('unknown URL: 404 with the not-found page and the headers', [
    ...(missing.status === 404 ? [] : [`status ${missing.status}`]),
    ...expectHeader(missing, 'content-type', (v) => v.startsWith('text/html'), 'text/html'),
    ...(missingHtml.includes('__reactRouterContext') ? [] : ['not the SPA fallback page']),
    ...securityProblems(missing, cspName),
  ]);

  // Assets named by the home page and the engine list.
  const assetUrls = [...homeHtml.matchAll(/(?:href|src)="([^"]*\/assets\/[^"]+\.(?:js|css))"/g)]
    .map((m) => new URL(m[1] ?? '', base).href)
    .filter((u, i, all) => all.indexOf(u) === i);
  const js = assetUrls.find((u) => u.endsWith('.js'));
  const css = assetUrls.find((u) => u.endsWith('.css'));
  const enginesRes = await get(`${base}pwa-engines.json`);
  const engines = enginesRes.ok
    ? Object.keys(((await enginesRes.json()) as { files?: Record<string, unknown> }).files ?? {})
    : [];
  const wasm = engines.find((f) => f.endsWith('.wasm'));
  const mjs = engines.find((f) => f.endsWith('.mjs'));

  const assetChecks: Array<[string, string | undefined, RegExp, string]> = [
    ['JS asset', js, /javascript/, CACHE_IMMUTABLE],
    ['CSS asset', css, /^text\/css/, CACHE_IMMUTABLE],
    ['.wasm', wasm && `${base}assets/${wasm}`, /^application\/wasm$/, CACHE_IMMUTABLE],
    ['.mjs (pdf.js worker)', mjs && `${base}assets/${mjs}`, /javascript/, CACHE_IMMUTABLE],
    ['icon', `${base}icons/icon-192.png`, /^image\/png/, CACHE_IMMUTABLE],
    ['sw.js', `${base}sw.js`, /javascript/, CACHE_NO_CACHE],
    ['manifest', `${base}manifest.webmanifest`, /^application\/manifest\+json/, CACHE_NO_CACHE],
    ['sitemap.xml', `${base}sitemap.xml`, /xml/, CACHE_NO_CACHE],
    ['robots.txt', `${base}robots.txt`, /^text\/plain/, CACHE_NO_CACHE],
    ['engine list', `${base}pwa-engines.json`, /json/, CACHE_NO_CACHE],
  ];
  for (const [name, url, type, cache] of assetChecks) {
    if (!url) {
      record(name, ['not found in the home page / pwa-engines.json']);
      continue;
    }
    const res = await get(url, { headers: { 'accept-encoding': 'br, gzip' } });
    await res.arrayBuffer();
    const problems = [
      ...(res.status === 200 ? [] : [`status ${res.status}`]),
      ...expectHeader(res, 'content-type', (v) => type.test(v), String(type)),
      ...expectHeader(res, 'cache-control', (v) => v === cache, cache),
      ...securityProblems(res, cspName),
    ];
    // Production sends .gz/.br (gzip_static); `vite preview` doesn't compress, so live only.
    if (live && /\.(?:js|css|wasm|mjs)$/.test(url)) {
      problems.push(
        ...expectHeader(res, 'content-encoding', (v) => /^(?:br|gzip)$/.test(v), 'br or gzip'),
      );
    }
    record(`${name}: type, cache, headers${live ? ', compression' : ''}`, problems);
  }
}

/** Collects console errors, page errors, CSP violations and requests to other sites. */
async function watch(page: Page, origin: string): Promise<() => Promise<string[]>> {
  const problems: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'}`);
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.context().on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== origin) {
      problems.push(`request to another site: ${r.method()} ${url.origin}${url.pathname}`);
    }
  });
  // Returns what happened since the last call (each flow reports its own problems).
  return async () => {
    const csp = await page
      .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
      .catch(() => []);
    return [...problems.splice(0), ...csp.map((v) => `CSP: ${v}`)];
  };
}

async function browserChecks(type: BrowserType, base: string): Promise<void> {
  const name = type.name();
  const browser = await type.launch();
  const origin = new URL(base).origin;
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const problems = await watch(page, origin);

    const flow = async (label: string, steps: () => Promise<void>) => {
      try {
        await steps();
        record(`${name}: ${label}`, await problems());
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        record(`${name}: ${label}`, [message ?? 'failed', ...(await problems())]);
      }
    };

    await flow('home page loads and hydrates', async () => {
      await page.goto(base);
      await page.getByRole('heading', { level: 1 }).waitFor();
      // The theme button only works after hydration.
      await page.getByRole('button', { name: /^Theme: / }).click();
      await page.getByText(/^Theme: (light|dark|follow device)$/).waitFor({ timeout: 10_000 });
      if (name === 'chromium' && !(await page.evaluate(() => crossOriginIsolated))) {
        throw new Error('crossOriginIsolated is false (COOP/COEP not working)');
      }
    });

    await flow('sample compress succeeds', async () => {
      await page.goto(`${base}compress-image`);
      await page.locator('[data-testid="compress-drop"][data-live="true"]').waitFor();
      await page.getByRole('button', { name: 'Try with a sample photo' }).click();
      await page.locator('[data-testid="compare"][data-fresh]').waitFor({ timeout: 120_000 });
    });

    await flow('sample merge succeeds', async () => {
      await page.goto(`${base}merge-pdf`);
      await page.getByRole('button', { name: 'Try with 4 sample PDFs' }).click();
      await page
        .getByTestId('merge-card')
        .locator('[data-state="ready"] canvas')
        .nth(3)
        .waitFor({ timeout: 60_000 });
      await page.getByRole('button', { name: /^Merge \d+ PDFs$/ }).click();
      const downloadButton = page.getByRole('button', { name: 'Download PDF' });
      await downloadButton.waitFor({ timeout: 60_000 });
      const download = page.waitForEvent('download');
      await downloadButton.click();
      const file = await download;
      if (!file.suggestedFilename().endsWith('.pdf')) {
        throw new Error(`download is ${file.suggestedFilename()}`);
      }
      const bytes = readFileSync((await file.path()) ?? '');
      if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('download is not a PDF');
    });
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      browsers: { type: 'string', default: 'chromium,webkit' },
      port: { type: 'string', default: '4480' },
      'upstream-port': { type: 'string', default: '5480' },
    },
  });
  const types = values.browsers
    .split(',')
    .map((b) => ({ chromium, webkit })[b.trim() as 'chromium' | 'webkit'])
    .filter((t): t is BrowserType => !!t);
  if (types.length === 0) throw new Error('--browsers: chromium and/or webkit');

  let preview: ChildProcess | undefined;
  let proxy: Server | undefined;
  let base: string;
  const options = templateOptionsFromEnv(REPO_ROOT);
  const cspName = options.reportOnly
    ? 'content-security-policy-report-only'
    : 'content-security-policy';
  try {
    if (values.url) {
      base = values.url.endsWith('/') ? values.url : `${values.url}/`;
      say(`Smoke test: ${base}`);
    } else {
      if (!existsSync(path.join(BUILD, 'index.html'))) {
        throw new Error('No build in build/client. Run `pnpm build` first.');
      }
      const upstreamPort = Number(values['upstream-port']);
      const port = Number(values.port);
      const headersConf = renderHeaders(headersTemplate(options), buildScriptHashes(BUILD));
      preview = await startPreview(upstreamPort);
      proxy = await startLocalNginx({ upstreamPort, port, headersConf });
      base = `http://127.0.0.1:${port}/snap-convert/`;
      say(`Smoke test: local build via vite preview :${upstreamPort} + nginx stand-in ${base}`);
    }

    await httpChecks(base, !!values.url, cspName);
    for (const type of types) await browserChecks(type, base);
  } finally {
    proxy?.close();
    preview?.kill();
  }

  const failed = results.filter((r) => !r.ok);
  say(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Smoke test stopped: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
