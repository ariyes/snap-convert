// A stand-in for production nginx in front of `vite preview`, for the local smoke test (P25).
//
// `vite preview` already answers URLs the way nginx-snap-convert.conf does (vite.config.ts:
// try_files + the 404 SPA fallback). This proxy adds what only nginx sends: the security headers
// and CSP from the generated security-headers.conf (the same text nginx includes), the
// Cache-Control of each location, the forced types (wasm, mjs, manifest) and the
// /snap-convert → /snap-convert/ redirect.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import path from 'node:path';
import { BASE_PATH, pathRule } from './headers.ts';
import { parseHeaders, REPO_ROOT } from './csp.ts';

/** Waits until a URL answers 200. */
export async function waitFor(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`${url} did not start`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * `vite preview` of build/client on 127.0.0.1:<port> (same as `pnpm preview`, started directly so
 * it can be stopped on Windows too). The caller kills it.
 */
export async function startPreview(port: number): Promise<ChildProcess> {
  const vite = path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js');
  const args = ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const child = spawn(process.execPath, [vite, ...args], { cwd: REPO_ROOT, stdio: 'ignore' });
  try {
    await waitFor(`http://127.0.0.1:${port}${BASE_PATH}`, 60_000);
  } catch (error) {
    child.kill();
    throw error;
  }
  return child;
}

export interface LocalNginxOptions {
  /** Port of `vite preview`. */
  upstreamPort: number;
  /** Port this stand-in listens on. */
  port: number;
  /** Rendered security-headers.conf. */
  headersConf: string;
}

/** Headers nginx would send for a response from the preview server. */
export function nginxResponseHeaders(
  pathname: string,
  upstream: IncomingHttpHeaders,
  securityHeaders: Array<[string, string]>,
): Record<string, string | string[]> {
  const rule = pathRule(pathname);
  const out: Record<string, string | string[]> = {};
  const replaced = new Set(
    ['cache-control', ...securityHeaders.map(([name]) => name.toLowerCase())].concat(
      rule.contentType ? ['content-type'] : [],
    ),
  );
  for (const [name, value] of Object.entries(upstream)) {
    if (value !== undefined && !replaced.has(name.toLowerCase())) out[name] = value;
  }
  for (const [name, value] of securityHeaders) out[name] = value;
  out['Cache-Control'] = rule.cacheControl;
  if (rule.contentType) out['Content-Type'] = rule.contentType;
  return out;
}

export function startLocalNginx({
  upstreamPort,
  port,
  headersConf,
}: LocalNginxOptions): Promise<Server> {
  const security = parseHeaders(headersConf);
  if (security.length === 0) throw new Error('security-headers.conf has no add_header lines');
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === BASE_PATH.slice(0, -1)) {
      res.writeHead(301, { Location: BASE_PATH });
      res.end();
      return;
    }
    if (!url.pathname.startsWith(BASE_PATH)) {
      // In production these go to crkayes.com's Next.js app.
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not part of Snap Convert');
      return;
    }
    const upstream = request(
      {
        host: '127.0.0.1',
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `localhost:${upstreamPort}` },
      },
      (up) => {
        res.writeHead(
          up.statusCode ?? 502,
          nginxResponseHeaders(url.pathname, up.headers, security),
        );
        up.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`preview server: ${error.message}`);
    });
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
