// Real-world test files for e2e/real-world.spec.ts (P24). See tests/fixtures/real/README.md.
// Big files are generated on first use into tests/fixtures/real/generated/ (git-ignored) and
// reused afterwards. Files the owner supplies go in tests/fixtures/real/owner/ (also git-ignored).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const REAL_DIR = path.resolve('tests/fixtures/real');
const GENERATED = path.join(REAL_DIR, 'generated');
export const OWNER_DIR = path.join(REAL_DIR, 'owner');

export interface Upload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const upload = (name: string, buffer: Buffer): Upload => ({ name, mimeType: '', buffer });

async function cached(name: string, make: () => Promise<Buffer>): Promise<Upload> {
  const file = path.join(GENERATED, name);
  if (!existsSync(file)) {
    mkdirSync(GENERATED, { recursive: true });
    writeFileSync(file, await make());
  }
  return upload(name, readFileSync(file));
}

export const fixture = (file: string, name = path.basename(file)): Upload =>
  upload(name, readFileSync(path.resolve('tests/fixtures', file)));

/** Owner-supplied files in tests/fixtures/real/owner/, if any. */
export function ownerFiles(): Upload[] {
  if (!existsSync(OWNER_DIR)) return [];
  return readdirSync(OWNER_DIR)
    .filter((n) => !n.startsWith('.') && n !== 'README.md')
    .map((n) => upload(n, readFileSync(path.join(OWNER_DIR, n))));
}

type WithBlob = { __real?: Blob };

/** Copies the blob a page left in `window.__real` out to Node, 6 MB at a time. */
async function pull(page: Page): Promise<Buffer> {
  const size = await page.evaluate(() => (window as unknown as WithBlob).__real!.size);
  const parts: Buffer[] = [];
  const CHUNK = 6 * 1024 * 1024;
  for (let at = 0; at < size; at += CHUNK) {
    const base64 = await page.evaluate(
      async ({ at, n }) => {
        const blob = (window as unknown as WithBlob).__real!.slice(at, at + n);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(s);
      },
      { at, n: CHUNK },
    );
    parts.push(Buffer.from(base64, 'base64'));
  }
  return Buffer.concat(parts);
}

/**
 * 8000×6000 (48 MP) JPEG, like a modern phone's full-resolution mode: the fine-detail reference
 * photo enlarged, with per-pixel luma/chroma noise so it has real high-frequency detail.
 */
export async function photo48mp(page: Page): Promise<Upload> {
  return cached('photo-48mp.jpg', async () => {
    const source = readFileSync(path.resolve('tests/fixtures/quality/photo-fine-detail.jpg'));
    await page.evaluate(async (base64) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data]));
      const W = 8000;
      const H = 6000;
      const canvas = new OffscreenCanvas(W, H);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      // Cover crop of the 16:9 source into 4:3.
      const sw = (bitmap.height * W) / H;
      ctx.drawImage(bitmap, (bitmap.width - sw) / 2, 0, sw, bitmap.height, 0, 0, W, H);
      let seed = 48;
      const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296 - 0.5;
      for (let y = 0; y < H; y += 500) {
        const img = ctx.getImageData(0, y, W, 500);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const l = rnd() * 18;
          d[i] = d[i]! + l + rnd() * 6;
          d[i + 1] = d[i + 1]! + l + rnd() * 6;
          d[i + 2] = d[i + 2]! + l + rnd() * 6;
        }
        ctx.putImageData(img, 0, y);
      }
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
      (window as unknown as WithBlob).__real = blob;
    }, source.toString('base64'));
    return pull(page);
  });
}

/** A real 2× (retina) screenshot of a Snap Convert page: UI text, icons, flat colours. */
export async function screenshotPng(browser: Browser, baseURL: string): Promise<Upload> {
  return cached('screenshot-text.png', async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      baseURL,
    });
    const page = await context.newPage();
    await page.goto('privacy');
    const png = await page.screenshot();
    await context.close();
    return png;
  });
}

/** Transparent logo PNG (1024 px, anti-aliased edges, soft shadow) from the app's mark. */
export async function logoPng(browser: Browser): Promise<Upload> {
  return cached('logo-transparent.png', async () => {
    const context = await browser.newContext({
      viewport: { width: 512, height: 512 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style>
      <svg width="512" height="512" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <defs><filter id="s"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity=".35"/></filter></defs>
        <rect x="6" y="6" width="52" height="52" rx="13" fill="#c2410c" filter="url(#s)"/>
        <path d="M35 12 18 36h12l-3 16 18-25H33z" fill="#fff"/>
        <text x="32" y="62" font-family="Arial" font-size="5" text-anchor="middle" fill="#1c1917">SNAP CONVERT</text>
      </svg>`);
    const png = await page.locator('svg').screenshot({ omitBackground: true });
    await context.close();
    return png;
  });
}

/** 300 A4 pages of text with a heading, body lines and a vector chart on every tenth page. */
export async function pdf300(): Promise<Upload> {
  return cached('report-300-pages.pdf', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    for (let n = 1; n <= 300; n++) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(`Annual report — section ${Math.ceil(n / 10)}`, {
        x: 56,
        y: 780,
        size: 18,
        font: bold,
      });
      for (let line = 0; line < 40; line++) {
        page.drawText(
          `Line ${line + 1}: the quick brown fox jumps over the lazy dog, page ${n} of 300.`,
          { x: 56, y: 740 - line * 16, size: 10, font },
        );
      }
      if (n % 10 === 0) {
        for (let b = 0; b < 8; b++) {
          page.drawRectangle({
            x: 80 + b * 50,
            y: 60,
            width: 30,
            height: 20 + ((b * 37 + n) % 90),
            color: rgb(0.76, 0.25, 0.05),
          });
        }
      }
      page.drawText(String(n), { x: 290, y: 30, size: 9, font });
    }
    return Buffer.from(await doc.save());
  });
}

/** 12-page scanned-style PDF: every page one 200 dpi greyish JPEG with tilted text and noise. */
export async function scannedPdf(page: Page): Promise<Upload> {
  return cached('scanned-12-pages.pdf', async () => {
    const doc = await PDFDocument.create();
    for (let n = 1; n <= 12; n++) {
      await page.evaluate(async (n) => {
        const W = 1654;
        const H = 2339;
        const canvas = new OffscreenCanvas(W, H);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#efece4';
        ctx.fillRect(0, 0, W, H);
        ctx.translate(W / 2, H / 2);
        ctx.rotate(((n % 3) - 1) * 0.006);
        ctx.translate(-W / 2, -H / 2);
        ctx.fillStyle = '#222';
        ctx.font = 'bold 54px Georgia';
        ctx.fillText(`Scanned letter, page ${n}`, 150, 220);
        ctx.font = '30px Georgia';
        for (let line = 0; line < 52; line++) {
          ctx.fillText(
            `Dear reader, this is line ${line + 1} of a scanned page with small serif text.`,
            150,
            330 + line * 36,
          );
        }
        const img = ctx.getImageData(0, 0, W, H);
        let seed = n;
        for (let i = 0; i < img.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          const v = ((seed >>> 24) - 128) / 12;
          img.data[i] = img.data[i]! + v;
          img.data[i + 1] = img.data[i + 1]! + v;
          img.data[i + 2] = img.data[i + 2]! + v;
        }
        ctx.putImageData(img, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        (window as unknown as WithBlob).__real = blob;
      }, n);
      const jpg = await doc.embedJpg(await pull(page));
      const p = doc.addPage([595.28, 841.89]);
      p.drawImage(jpg, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    return Buffer.from(await doc.save());
  });
}
