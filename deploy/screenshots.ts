// README / project-page screenshots (P25) from the production build, in Chromium.
//
//   pnpm build && node deploy/screenshots.ts [--port 5480]
//
// Writes docs/launch/screenshots/{home-light,compress-dark,phone-light}.png. Uses the sample photo
// that ships with the app, so no personal file ends up in the repository.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import { REPO_ROOT } from './csp.ts';
import { startPreview } from './local-nginx.ts';

const OUT = path.join(REPO_ROOT, 'docs/launch/screenshots');

async function compressSample(page: Page, base: string): Promise<void> {
  await page.goto(`${base}compress-image`);
  await page.locator('[data-testid="compress-drop"][data-live="true"]').waitFor();
  await page.getByRole('button', { name: 'Try with a sample photo' }).click();
  await page.locator('[data-testid="compare"][data-fresh]').waitFor({ timeout: 120_000 });
  // Let the result images finish painting.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

const { values } = parseArgs({ options: { port: { type: 'string', default: '5480' } } });
const port = Number(values.port);
const base = `http://127.0.0.1:${port}/snap-convert/`;
mkdirSync(OUT, { recursive: true });

const preview = await startPreview(port);
const browser = await chromium.launch();
try {
  const shoot = async (
    file: string,
    options: { dark?: boolean; phone?: boolean },
    steps: (page: Page) => Promise<void>,
  ) => {
    const context = await browser.newContext({
      viewport: options.phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      deviceScaleFactor: options.phone ? 2 : 1,
      isMobile: !!options.phone,
      hasTouch: !!options.phone,
      colorScheme: options.dark ? 'dark' : 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await steps(page);
    await page.screenshot({ path: path.join(OUT, file) });
    await context.close();
    process.stdout.write(`Wrote docs/launch/screenshots/${file}\n`);
  };

  await shoot('home-light.png', {}, async (page) => {
    await page.goto(base);
    await page.waitForLoadState('networkidle');
  });
  await shoot('compress-dark.png', { dark: true }, (page) => compressSample(page, base));
  await shoot('phone-light.png', { phone: true }, (page) => compressSample(page, base));
} finally {
  await browser.close();
  preview.kill();
}
