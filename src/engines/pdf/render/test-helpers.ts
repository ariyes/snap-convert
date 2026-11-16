// Shared by the P08 browser tests only.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import cjkUrl from '../../../../tests/fixtures/pdf-render/cjk-cmap.pdf?url';
import encryptedOwnerUrl from '../../../../tests/fixtures/pdf-render/encrypted-owner.pdf?url';
import encryptedUserUrl from '../../../../tests/fixtures/pdf-render/encrypted-user.pdf?url';
import mixedUrl from '../../../../tests/fixtures/pdf-render/mixed-sizes.pdf?url';
import textUrl from '../../../../tests/fixtures/pdf-render/text-fonts.pdf?url';

export const fixtureUrls = {
  mixed: mixedUrl,
  text: textUrl,
  cjk: cjkUrl,
  encryptedUser: encryptedUserUrl,
  encryptedOwner: encryptedOwnerUrl,
} as const;

export type FixtureName = keyof typeof fixtureUrls;

const bytes = new Map<FixtureName, ArrayBuffer>();

/** Downloads every fixture once, so tests that watch the network start from a quiet page. */
export async function preloadFixtures(): Promise<void> {
  for (const [name, url] of Object.entries(fixtureUrls) as [FixtureName, string][]) {
    if (!bytes.has(name)) bytes.set(name, await (await fetch(url)).arrayBuffer());
  }
}

/** A fresh File (a new cache key) with the fixture's bytes. */
export function fixture(name: FixtureName): File {
  const data = bytes.get(name);
  if (!data) throw new Error(`Call preloadFixtures() first (${name})`);
  return new File([data], `${name}.pdf`, { type: 'application/pdf' });
}

/** A 100-page A4 PDF with text and vector shapes on every page. */
export async function hundredPagePdf(): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 100; p++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${p + 1}`, { x: 50, y: 780, size: 36, font });
    for (let line = 0; line < 40; line++) {
      page.drawText('The quick brown fox jumps over the lazy dog. 0123456789', {
        x: 50,
        y: 740 - line * 16,
        size: 11,
        font,
      });
    }
    for (let r = 0; r < 30; r++) {
      page.drawRectangle({
        x: 40 + (r % 6) * 85,
        y: 40 + Math.floor(r / 6) * 18,
        width: 70,
        height: 12,
        color: rgb(((r * 37) % 255) / 255, ((p * 11) % 255) / 255, 0.5),
      });
    }
  }
  const data = await doc.save();
  return new File([new Uint8Array(data)], 'hundred.pdf', { type: 'application/pdf' });
}

/** RGBA of one pixel of a bitmap. */
export function pixelAt(bitmap: ImageBitmap, x: number, y: number): number[] {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(bitmap, 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

/** One row of grey values (0–255) across a bitmap. */
export function greyRow(bitmap: ImageBitmap, y: number): number[] {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, y, bitmap.width, 1).data;
  const row: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    row.push(Math.round((data[i]! + data[i + 1]! + data[i + 2]!) / 3));
  }
  return row;
}

/** Same-origin check for a resource timing entry. */
export function isSameOrigin(entry: PerformanceEntry): boolean {
  return new URL(entry.name, location.href).origin === location.origin;
}
