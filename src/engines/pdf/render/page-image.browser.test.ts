import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import a0Url from '../../../../tests/fixtures/pdf-to-images/a0-page.pdf?url';
import mixedPagesUrl from '../../../../tests/fixtures/pdf-to-images/mixed-pages.pdf?url';
import smallTextUrl from '../../../../tests/fixtures/pdf-to-images/small-text.pdf?url';
import a4ThreeUrl from '../../../../tests/fixtures/pdf/a4-3-pages.pdf?url';
import { renderSlots } from './api';
import { PAGE_IMAGE_LIMITS, PdfRenderError, renderPageImage } from './index';
import { probeCanvasPixelLimit, resetCanvasPixelLimit } from './page-image';
import { fixture, hundredPagePdf, preloadFixtures } from './test-helpers';

const urls = { a0: a0Url, mixed: mixedPagesUrl, smallText: smallTextUrl, a4Three: a4ThreeUrl };
const bytes = new Map<keyof typeof urls, ArrayBuffer>();

function pdf(name: keyof typeof urls): File {
  const data = bytes.get(name);
  if (!data) throw new Error(`not loaded: ${name}`);
  return new File([data], `${name}.pdf`, { type: 'application/pdf' });
}

async function pixels(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Share of dark pixels (all channels < 128) in a box given in PDF points from the bottom left. */
function darkShare(img: ImageData, dpi: number, pageHeightPt: number, box: number[]): number {
  const [x, y, w, h] = box.map((v) => Math.round((v * dpi) / 72)) as [
    number,
    number,
    number,
    number,
  ];
  const top = Math.round((pageHeightPt * dpi) / 72) - y - h;
  let dark = 0;
  for (let row = top; row < top + h; row++) {
    for (let col = x; col < x + w; col++) {
      const i = (row * img.width + col) * 4;
      if (img.data[i]! < 128 && img.data[i + 1]! < 128 && img.data[i + 2]! < 128) dark++;
    }
  }
  return dark / (w * h);
}

beforeAll(async () => {
  await preloadFixtures();
  for (const [name, url] of Object.entries(urls) as [keyof typeof urls, string][]) {
    bytes.set(name, await (await fetch(url)).arrayBuffer());
  }
});

afterEach(() => {
  resetCanvasPixelLimit();
  vi.restoreAllMocks();
});

describe('renderPageImage', () => {
  it('draws an A4 page at 150 dpi as a 1240 × 1754 lossless PNG on white', async () => {
    const file = pdf('a4Three');
    for (const index of [0, 1, 2]) {
      const page = await renderPageImage(file, index, 150);
      expect(page).toMatchObject({ width: 1240, height: 1754, dpi: 150, reduced: false });
      expect(page.blob.type).toBe('image/png');
      const img = await pixels(page.blob);
      expect([img.width, img.height]).toEqual([1240, 1754]);
      // White, opaque background.
      expect(Array.from(img.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
      const mid = ((img.height >> 1) * img.width + (img.width >> 1)) * 4;
      expect(img.data[mid + 3]).toBe(255);
    }
  });

  it('keeps rotated and landscape pages landscape', async () => {
    const file = pdf('mixed');
    const sizes = [];
    for (const index of [0, 1, 2]) {
      const { width, height } = await renderPageImage(file, index, 72);
      sizes.push([width, height]);
    }
    expect(sizes).toEqual([
      [595, 842], // A4 portrait
      [842, 595], // A4 with /Rotate 90
      [792, 612], // Letter landscape
    ]);
  });

  it('renders as printed: printable form values appear, screen-only ones do not', async () => {
    const page = await renderPageImage(pdf('smallText'), 0, 150);
    const img = await pixels(page.blob);
    // The fields sit side by side near the bottom of the text block (see the fixture generator):
    // find their row from the red box, which shares it.
    let redRow = -1;
    for (let row = 0; row < img.height && redRow < 0; row++) {
      const i = (row * img.width + Math.round((60 * 150) / 72)) * 4;
      if (img.data[i]! > 180 && img.data[i + 1]! < 80) redRow = row;
    }
    expect(redRow).toBeGreaterThan(0);
    const toPt = (px: number) => (px * 72) / 150;
    const fieldBottomPt = 841.89 - toPt(redRow) - 60;
    const printed = darkShare(img, 150, 841.89, [245, fieldBottomPt + 4, 140, 20]);
    const screenOnly = darkShare(img, 150, 841.89, [405, fieldBottomPt + 4, 140, 20]);
    expect(printed).toBeGreaterThan(0.05);
    expect(screenOnly).toBe(0);
  });

  it('draws small text with hard edges (no blur)', async () => {
    const page = await renderPageImage(pdf('smallText'), 0, 150);
    const img = await pixels(page.blob);
    // The 1 pt rule is a solid black band: its middle row is fully black across the page.
    let solidRows = 0;
    for (let row = 0; row < img.height; row++) {
      let black = 0;
      for (let col = 100; col < 1100; col++) {
        const i = (row * img.width + col) * 4;
        if (img.data[i]! < 40 && img.data[i + 1]! < 40 && img.data[i + 2]! < 40) black++;
      }
      if (black === 1000) solidRows++;
    }
    expect(solidRows).toBeGreaterThanOrEqual(1);
  });

  it('smooths black text in grey only: no coloured (LCD subpixel) fringes', async () => {
    const page = await renderPageImage(pdf('smallText'), 0, 150);
    const img = await pixels(page.blob);
    // The black text lines at the top of the page (title and Helvetica 5–12 pt).
    let spread = 0;
    let inked = 0;
    for (let row = 60; row < 330; row++) {
      for (let col = 80; col < 1180; col++) {
        const i = (row * img.width + col) * 4;
        const [r, g, b] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
        if (r < 250) inked++;
        spread = Math.max(spread, Math.max(r, g, b) - Math.min(r, g, b));
      }
    }
    expect(inked).toBeGreaterThan(10_000);
    expect(spread).toBeLessThanOrEqual(2);
  });

  it('caps 300 dpi on an A0 page at 50 MP and says which DPI it used', async () => {
    const page = await renderPageImage(pdf('a0'), 0, 300);
    expect(page.reduced).toBe(true);
    expect(page.dpi).toBe(179);
    expect(page.width * page.height).toBeLessThanOrEqual(PAGE_IMAGE_LIMITS.maxPixels);
    expect(page.width * page.height).toBeGreaterThan(49_000_000);
    const bitmap = await createImageBitmap(page.blob);
    expect([bitmap.width, bitmap.height]).toEqual([page.width, page.height]);
    bitmap.close();
  });

  it('uses 16 MP on a device that cannot make a 50 MP canvas', async () => {
    resetCanvasPixelLimit(PAGE_IMAGE_LIMITS.smallDevicePixels);
    const page = await renderPageImage(pdf('a0'), 0, 300);
    expect(page).toMatchObject({ reduced: true, dpi: 101 });
    expect(page.width * page.height).toBeLessThanOrEqual(16_000_000);
  });

  it('frees every canvas it draws on', async () => {
    const made: OffscreenCanvas[] = [];
    const Real = OffscreenCanvas;
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends Real {
        constructor(width: number, height: number) {
          super(width, height);
          made.push(this);
        }
      },
    );
    const page = await renderPageImage(pdf('a4Three'), 1, 150);
    vi.unstubAllGlobals();
    expect(page.width).toBe(1240);
    expect(made.length).toBeGreaterThan(0);
    expect(made.map((c) => c.width * c.height)).toEqual(made.map(() => 0));
  });

  it('renders at most 2 pages at a time', async () => {
    const file = await hundredPagePdf();
    let maxActive = 0;
    let watching = true;
    const watch = () => {
      maxActive = Math.max(maxActive, renderSlots.active);
      if (watching) setTimeout(watch, 0);
    };
    watch();
    const pages = await Promise.all(
      Array.from({ length: 8 }, (_, i) => renderPageImage(file, i, 72)),
    );
    watching = false;
    expect(pages.every((p) => p.width === 595)).toBe(true);
    expect(maxActive).toBe(2);
  });

  it('stops when aborted', async () => {
    await expect(
      renderPageImage(pdf('a4Three'), 0, 150, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const controller = new AbortController();
    const running = renderPageImage(await hundredPagePdf(), 3, 600, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderSlots.active).toBe(0);
  });

  it('rejects bad pages, bad DPI and password-protected files', async () => {
    await expect(renderPageImage(pdf('a4Three'), 3, 150)).rejects.toBeInstanceOf(RangeError);
    await expect(renderPageImage(pdf('a4Three'), 0, 0)).rejects.toBeInstanceOf(RangeError);
    const locked = renderPageImage(fixture('encryptedUser'), 0, 150);
    await expect(locked).rejects.toBeInstanceOf(PdfRenderError);
    await expect(locked).rejects.toMatchObject({ code: 'encrypted' });
  });
});

describe('probeCanvasPixelLimit', () => {
  it('finds 50 MP in this browser', () => {
    expect(probeCanvasPixelLimit()).toBe(PAGE_IMAGE_LIMITS.maxPixels);
  });

  it('falls back to 16 MP when a big canvas has no context or reads back blank', () => {
    const big = (w: number, h: number) => w * h > 20_000_000;
    const noContext = (w: number, h: number) => {
      const c = new OffscreenCanvas(w, h);
      if (big(w, h)) Object.defineProperty(c, 'getContext', { value: () => null });
      return c;
    };
    expect(probeCanvasPixelLimit(noContext)).toBe(PAGE_IMAGE_LIMITS.smallDevicePixels);

    // Like iPhone Safari over its limit: a canvas that silently draws nothing.
    const blank = (w: number, h: number) => {
      const c = new OffscreenCanvas(w, h);
      if (big(w, h)) {
        const ctx = c.getContext('2d')!;
        Object.defineProperty(ctx, 'getImageData', { value: () => new ImageData(1, 1) });
        Object.defineProperty(c, 'getContext', { value: () => ctx });
      }
      return c;
    };
    expect(probeCanvasPixelLimit(blank)).toBe(PAGE_IMAGE_LIMITS.smallDevicePixels);

    // Neither size works: the smaller limit is used (the render then reports its own error).
    const none = (w: number, h: number) => {
      const c = new OffscreenCanvas(w, h);
      Object.defineProperty(c, 'getContext', { value: () => null });
      return c;
    };
    expect(probeCanvasPixelLimit(none)).toBe(PAGE_IMAGE_LIMITS.smallDevicePixels);
  });
});
