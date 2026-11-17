// P24: the app works under the Content-Security-Policy proposed for launch (docs/launch/headers.md).
// Every same-origin response gets the policy as a header, the way nginx would send it: one policy
// for the whole site, with the sha256 of every inline <script> in the build (theme script, install
// prompt capture, React Router's hydration scripts). Pages, image/HEIC/PDF engines, workers, wasm,
// ZIP and toasts must run with no CSP violation.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { prerenderRoutes } from '../src/app/prerender-routes';
import { expect, test, type Page } from './support/test';

const BUILD = path.resolve('build/client');

/** sha256 sources for every executable inline script in the built HTML. */
function inlineScriptHashes(): string[] {
  const hashes = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) {
        if (name !== 'assets') walk(file);
      } else if (name.endsWith('.html')) {
        const html = readFileSync(file, 'utf8');
        for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
          if (/\bsrc=|type="application\/(ld\+)?json"/.test(m[1] ?? '')) continue;
          hashes.add(
            `'sha256-${createHash('sha256')
              .update(m[2] ?? '')
              .digest('base64')}'`,
          );
        }
      }
    }
  };
  walk(BUILD);
  return [...hashes].sort();
}

/** The launch policy (keep in step with docs/launch/headers.md). */
export function launchPolicy(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${scriptHashes.join(' ')}`,
    "worker-src 'self' blob:",
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

const fixture = (file: string, name = path.basename(file)) => ({
  name,
  mimeType: '',
  buffer: readFileSync(path.resolve('tests/fixtures', file)),
});

// The service worker would answer from its cache without the test's header.
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 120_000 });

let policy = '';
test.beforeAll(() => {
  policy = launchPolicy(inlineScriptHashes());
});

/** Serves every same-origin response with the policy and collects violations and errors. */
async function withPolicy(page: Page, baseURL: string | undefined): Promise<string[]> {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const problems: string[] = [];
  await page.route(
    (url) => url.protocol.startsWith('http') && url.origin === origin,
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': policy },
      });
    },
  );
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
  return problems;
}

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

test('every page hydrates under the policy', async ({ page, baseURL }) => {
  const problems = await withPolicy(page, baseURL);
  for (const route of prerenderRoutes) {
    const response = await page.goto(`.${route}`);
    expect(response?.headers()['content-security-policy']).toBe(policy);
    await page.waitForLoadState('networkidle');
    expect(await violations(page), route).toEqual([]);
  }
  // A toast (sonner adds its own <style>) and client-side navigation.
  await page.goto('./');
  await page.getByRole('button', { name: /^Theme: / }).click();
  await expect(page.getByText(/^Theme: (light|dark|follow device)$/)).toBeVisible();
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('image engine (worker, wasm codecs) runs under the policy', async ({ page, baseURL }) => {
  const problems = await withPolicy(page, baseURL);
  await page.goto('compress-image');
  await expect(page.getByTestId('compress-drop')).toHaveAttribute('data-live', 'true');
  await page.getByRole('button', { name: 'Try with a sample photo' }).click();
  await expect(page.locator('[data-testid="compare"][data-fresh]')).toBeVisible({
    timeout: 90_000,
  });
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('HEIC decoder (libheif wasm) runs under the policy', async ({ page, baseURL }) => {
  const problems = await withPolicy(page, baseURL);
  await page.goto('heic-to-jpg');
  const zone = page.getByRole('button', { name: /^Drop HEIC photos here/ });
  await expect(async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 5_000 });
    await zone.click();
    await (await chooser).setFiles([fixture('images/iphone-7.heic')]);
  }).toPass({ timeout: 40_000 });
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled({
    timeout: 100_000,
  });
  await expect(page.getByTestId('result-stat')).toContainText('4032×3024');
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('PDF engines (pdf.js thumbnails, pdf-lib merge) run under the policy', async ({
  page,
  baseURL,
}) => {
  const problems = await withPolicy(page, baseURL);
  await page.goto('merge-pdf');
  await page.getByRole('button', { name: 'Try with 4 sample PDFs' }).click();
  const cards = page.getByTestId('merge-card');
  await expect(cards.locator('[data-state="ready"] canvas')).toHaveCount(4, { timeout: 30_000 });
  await page.getByRole('button', { name: /^Merge \d+ PDFs$/ }).click();
  const downloadButton = page.getByRole('button', { name: 'Download PDF' });
  await expect(downloadButton).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent('download');
  await downloadButton.click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('Bulk and the ZIP worker run under the policy', async ({ page, baseURL }) => {
  const problems = await withPolicy(page, baseURL);
  await page.goto('bulk-resize');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Drop as many images as you like/ }).click();
  await (
    await chooser
  ).setFiles([fixture('images/no-exif.jpg', 'a.jpg'), fixture('images/sample.webp', 'b.webp')]);
  await page.getByRole('button', { name: /^Resize \d+ images?$/ }).click();
  await expect(page.getByTestId('bulk-summary')).toContainText('2 done', { timeout: 60_000 });
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download ZIP' })
    .filter({ visible: true })
    .first()
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});
