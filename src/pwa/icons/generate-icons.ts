// Draws the app icons from the Logo mark (src/ui/logo.tsx) into public/icons/.
// Run after changing the logo or the brand colours, then commit the PNGs:
//   node src/pwa/icons/generate-icons.ts
// Uses Playwright's Chromium (already installed for the tests) to turn SVG into PNG.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ICONS, THEME_COLOR } from '../brand.ts';

/** The bolt from the Logo mark, drawn in a 24×24 box (lucide "zap"). */
const BOLT =
  'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z';
/** Light theme `--on-accent`. */
const ON_ACCENT = '#fff';

/** The bolt scaled to `box` (in a 32×32 view box), centred. */
function bolt(box: number): string {
  const offset = (32 - box) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${box / 24})"><path d="${BOLT}" fill="${ON_ACCENT}"/></g>`;
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="SIZE" height="SIZE" style="display:block">${body}</svg>`;

/** Exactly the Logo mark: rounded square with a 1/32 transparent margin. */
const anyIcon = svg(
  `<rect x="1" y="1" width="30" height="30" rx="8" fill="${THEME_COLOR}"/>${bolt(22)}`,
);
/** Full-bleed square; the bolt stays well inside the maskable safe zone (centre circle, 80%). */
const maskableIcon = svg(`<rect width="32" height="32" fill="${THEME_COLOR}"/>${bolt(18)}`);
/** iOS rounds the corners itself and shows transparency as black, so: full-bleed, opaque. */
const appleIcon = svg(`<rect width="32" height="32" fill="${THEME_COLOR}"/>${bolt(20)}`);

const outputs: Array<{ file: string; size: number; markup: string }> = [
  { file: ICONS.any192, size: 192, markup: anyIcon },
  { file: ICONS.any512, size: 512, markup: anyIcon },
  { file: ICONS.maskable512, size: 512, markup: maskableIcon },
  { file: ICONS.apple, size: 180, markup: appleIcon },
  { file: ICONS.favicon32, size: 32, markup: anyIcon },
];

const publicDir = path.resolve(import.meta.dirname, '../../../public');

// The SVG favicon is the Logo mark itself, so it stays sharp at every tab size and screen density.
const faviconSvg = anyIcon.replace(' width="SIZE" height="SIZE" style="display:block"', '');
writeFileSync(path.join(publicDir, ICONS.faviconSvg), `${faviconSvg}\n`);
console.warn(`wrote public/${ICONS.faviconSvg}`);
const browser = await chromium.launch();
try {
  for (const { file, size, markup } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${markup.replaceAll('SIZE', String(size))}</body></html>`,
    );
    const png = await page.screenshot({ omitBackground: true, type: 'png' });
    const target = path.join(publicDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, png);
    await page.close();
    console.warn(`wrote ${path.relative(process.cwd(), target)} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
