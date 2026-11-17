// Every spec imports `test` and `expect` from here instead of '@playwright/test' (P24).
// It adds one automatic check to every test: no request the browser sends may carry file data.
// Allowed: same-origin GET/HEAD without a body, for a file the build actually serves (so nothing can
// be smuggled in a path or query), plus page navigations; and in-page data:/blob: URLs.
// Anything else (another host, a POST, a body, an unknown asset path) fails the test.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Request } from '@playwright/test';

export * from '@playwright/test';

const BUILD = path.resolve('build/client');
const BASE_PATH = '/snap-convert/';

function served(pathname: string): boolean {
  if (!pathname.startsWith(BASE_PATH)) return false;
  const rel = decodeURIComponent(pathname.slice(BASE_PATH.length)).replace(/\/$/, '');
  if (rel.split('/').includes('..')) return false;
  const file = path.join(BUILD, rel);
  if (existsSync(file) && statSync(file).isFile()) return true;
  return existsSync(path.join(file, 'index.html')) || existsSync(`${file}.data`);
}

/** Why this request could carry user data, or null when it can't. */
export function suspicious(request: Request, origin: string, allow: RegExp[] = []): string | null {
  const url = new URL(request.url());
  if (url.protocol === 'data:' || url.protocol === 'blob:') return null;
  const what = `${request.method()} ${request.url()}`;
  if (request.method() !== 'GET' && request.method() !== 'HEAD') return `method: ${what}`;
  if (request.postDataBuffer()) return `has a body: ${what}`;
  // A test's own helper server, or a URL the test itself asks for (e.g. a fake new sw.js).
  if (allow.some((pattern) => pattern.test(request.url()))) return null;
  if (url.origin !== origin) return `other host: ${what}`;
  if (request.isNavigationRequest()) return null;
  if (url.search) return `query string: ${what}`;
  if (!served(url.pathname)) return `not a built file: ${what}`;
  return null;
}

export const test = base.extend<{ networkGuard: void; allowRequests: RegExp[] }>({
  /** GET requests a spec makes on purpose that the guard should let through. */
  allowRequests: [[], { option: true }],
  networkGuard: [
    async ({ context, baseURL, allowRequests }, use) => {
      const origin = new URL(baseURL ?? 'http://localhost').origin;
      const problems: string[] = [];
      const check = (request: Request) => {
        const problem = suspicious(request, origin, allowRequests);
        if (problem) problems.push(problem);
      };
      context.on('request', check);
      await use();
      context.off('request', check);
      expect(problems, 'requests that could carry file data').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
