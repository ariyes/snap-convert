import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderSlots } from './api';
import { bundledAssetCounts } from './assets';
import { clearDocumentCache, isDocumentCached } from './documents';
import {
  PdfRenderError,
  readPdfInfo,
  renderPageThumbnail,
  renderThumbnails,
  MAX_CONCURRENT_RENDERS,
} from './index';
import {
  fixture,
  greyRow,
  hundredPagePdf,
  isSameOrigin,
  pixelAt,
  preloadFixtures,
  type FixtureName,
} from './test-helpers';

const realPixelRatio = window.devicePixelRatio;

function setPixelRatio(ratio: number) {
  // devicePixelRatio is a [Replaceable] window attribute, so a test can override it.
  Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true });
}

async function renderAll(file: Blob, maxSize: number) {
  const pages: Array<{ index: number; bitmap: ImageBitmap }> = [];
  await renderThumbnails(file, maxSize, (index, bitmap) => pages.push({ index, bitmap }));
  return pages;
}

const close = (pages: Array<{ bitmap: ImageBitmap }>) => pages.forEach((p) => p.bitmap.close());

beforeAll(async () => {
  performance.setResourceTimingBufferSize(2000);
  await preloadFixtures();
});

afterEach(() => {
  setPixelRatio(realPixelRatio);
});

describe('readPdfInfo', () => {
  it('reads the page count and displayed page sizes in points', async () => {
    const info = await readPdfInfo(fixture('mixed'));
    expect(info.pages).toBe(5);
    expect(info.encrypted).toBe(false);
    const sizes = info.pageSizes.map((s) =>
      [s.width, s.height].map((n) => Math.round(n * 100) / 100),
    );
    expect(sizes).toEqual([
      [595.28, 841.89], // A4
      [792, 612], // Letter landscape
      [200, 100], // custom
      [595.28, 419.53], // A5 with /Rotate 90 → shown landscape
      [500, 700], // CropBox inside a 600 × 800 MediaBox
    ]);
  });

  it('flags a password-protected PDF as encrypted without crashing', async () => {
    await expect(readPdfInfo(fixture('encryptedUser'))).resolves.toEqual({
      pages: 0,
      encrypted: true,
      pageSizes: [],
    });
  });

  it('flags an owner-password PDF as encrypted and still reads its pages', async () => {
    const info = await readPdfInfo(fixture('encryptedOwner'));
    expect(info).toMatchObject({ pages: 1, encrypted: true });
    expect(info.pageSizes).toEqual([{ width: 300, height: 400 }]);
  });

  it('rejects a file that is not a PDF with PdfRenderError("invalid")', async () => {
    const notPdf = new File(['hello, not a pdf'], 'x.pdf', { type: 'application/pdf' });
    const error: unknown = await readPdfInfo(notPdf).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfRenderError);
    expect(error).toMatchObject({ code: 'invalid' });
  });
});

describe('renderThumbnails', () => {
  it('renders every page in order, fitted to maxSize and never stretched', async () => {
    setPixelRatio(1);
    const file = fixture('mixed');
    const info = await readPdfInfo(file);
    const pages = await renderAll(file, 120);

    expect(pages.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    pages.forEach(({ index, bitmap }) => {
      const page = info.pageSizes[index]!;
      expect(Math.max(bitmap.width, bitmap.height)).toBe(120);
      // Same aspect ratio as the page (within rounding of the short side).
      const expectedShort =
        (Math.min(page.width, page.height) / Math.max(page.width, page.height)) * 120;
      expect(Math.abs(Math.min(bitmap.width, bitmap.height) - expectedShort)).toBeLessThanOrEqual(
        0.5,
      );
      expect(bitmap.width > bitmap.height).toBe(page.width > page.height);
    });

    // Each page is filled with its own colour.
    const colours = pages.map(({ bitmap }) =>
      pixelAt(bitmap, bitmap.width >> 1, bitmap.height >> 1).slice(0, 3),
    );
    expect(colours).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [255, 0, 255],
    ]);
    close(pages);
  });

  it('renders at the device pixel ratio so thumbnails are crisp on a 2× display', async () => {
    setPixelRatio(2);
    const [page] = await renderAll(fixture('text'), 150);
    const bitmap = page!.bitmap;
    expect(Math.max(bitmap.width, bitmap.height)).toBe(300);
    expect(bitmap.width).toBe(Math.round((595.28 / 841.89) * 300));

    // The black box (x = 50–545 pt) has hard edges: at most one in-between pixel per edge.
    const row = greyRow(bitmap, Math.round(bitmap.height * 0.6));
    const blurred = row.filter((v) => v > 40 && v < 215).length;
    expect(row.filter((v) => v <= 40).length).toBeGreaterThan(bitmap.width * 0.7);
    expect(blurred).toBeLessThanOrEqual(2);
    bitmap.close();
  });

  it('renders an owner-password PDF', async () => {
    const pages = await renderAll(fixture('encryptedOwner'), 40);
    expect(pages).toHaveLength(1);
    expect(pixelAt(pages[0]!.bitmap, 15, 20).slice(0, 3)).toEqual([0, 0, 255]);
    close(pages);
  });

  it('rejects a password-protected PDF with PdfRenderError("encrypted")', async () => {
    const onPage = (_: number, bitmap: ImageBitmap) => bitmap.close();
    await expect(renderThumbnails(fixture('encryptedUser'), 40, onPage)).rejects.toMatchObject({
      name: 'PdfRenderError',
      code: 'encrypted',
    });
  });

  it('shows the first thumbnail of a 100-page PDF within 1 s', async () => {
    setPixelRatio(1);
    await readPdfInfo(fixture('text')); // pdf.js itself is loaded once per visit; not timed here
    const file = await hundredPagePdf();
    const controller = new AbortController();
    const start = performance.now();
    let firstAt = 0;
    const done = renderThumbnails(
      file,
      160,
      (_, bitmap) => {
        firstAt ||= performance.now();
        bitmap.close();
        controller.abort();
      },
      controller.signal,
    );
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstAt).toBeGreaterThan(0);
    expect(firstAt - start).toBeLessThan(1000);
  });

  it('stops promptly when aborted and never calls onPage afterwards', async () => {
    const file = await hundredPagePdf();
    const controller = new AbortController();
    const seen: number[] = [];
    let abortedAt = 0;
    const done = renderThumbnails(
      file,
      160,
      (index, bitmap) => {
        seen.push(index);
        bitmap.close();
        if (seen.length === 2) {
          abortedAt = performance.now();
          controller.abort();
        }
      },
      controller.signal,
    );
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(performance.now() - abortedAt).toBeLessThan(250);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen).toEqual([0, 1]);
    expect(renderSlots.active).toBe(0);
  });

  it('renders at most 2 pages at a time, across files', async () => {
    const files = [await hundredPagePdf(), fixture('mixed'), fixture('text')];
    let maxActive = 0;
    let watching = true;
    const watch = () => {
      maxActive = Math.max(maxActive, renderSlots.active);
      if (watching) setTimeout(watch, 0);
    };
    watch();
    const controller = new AbortController();
    let count = 0;
    const runs = files.map((file) =>
      renderThumbnails(
        file,
        64,
        (_, bitmap) => {
          bitmap.close();
          if (++count === 30) controller.abort();
        },
        controller.signal,
      ).catch(() => {}),
    );
    await Promise.all(runs);
    watching = false;
    expect(MAX_CONCURRENT_RENDERS).toBe(2);
    expect(maxActive).toBe(2);
  });

  it('renders a single page for grids that only draw visible pages', async () => {
    setPixelRatio(1);
    const bitmap = await renderPageThumbnail(fixture('mixed'), 2, 100);
    expect([bitmap.width, bitmap.height]).toEqual([100, 50]);
    expect(pixelAt(bitmap, 50, 25).slice(0, 3)).toEqual([0, 0, 255]);
    bitmap.close();

    await expect(renderPageThumbnail(fixture('mixed'), 5, 100)).rejects.toBeInstanceOf(RangeError);
    await expect(
      renderPageThumbnail(fixture('mixed'), 0, 100, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps the loaded document per File for reuse', async () => {
    const file = fixture('mixed');
    expect(isDocumentCached(file)).toBe(false);
    await readPdfInfo(file);
    expect(isDocumentCached(file)).toBe(true);
    const start = performance.now();
    close(await renderAll(file, 32));
    expect(performance.now() - start).toBeLessThan(1000);
    expect(isDocumentCached(file)).toBe(true);
    expect(isDocumentCached(fixture('mixed'))).toBe(false); // keyed by File, not by content
  });
});

describe('network', () => {
  it('bundles the CMaps, standard fonts and image decoders pdf.js needs', () => {
    const counts = bundledAssetCounts();
    expect(counts.cMapUrl).toBeGreaterThan(150);
    expect(counts.standardFontDataUrl).toBeGreaterThanOrEqual(14);
    expect(counts.wasmUrl).toBe(2);
  });

  it('only loads files from our own origin, and only bundled ones', async () => {
    clearDocumentCache();
    performance.clearResourceTimings();
    const names: FixtureName[] = ['mixed', 'text', 'cjk', 'encryptedOwner', 'encryptedUser'];
    for (const name of names) {
      const file = fixture(name);
      await readPdfInfo(file);
      await renderThumbnails(file, 80, (_, bitmap) => bitmap.close()).catch(() => {});
    }
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    expect(entries.filter((e) => !isSameOrigin(e)).map((e) => e.name)).toEqual([]);

    // The CJK page needed a predefined CMap and the dingbats a standard font: both came from
    // our bundle and loaded successfully.
    const loaded = (part: string) =>
      entries.some((e) => e.name.includes(part) && e.responseStatus === 200);
    expect(loaded('UniJIS-UCS2-H')).toBe(true);
    expect(loaded('FoxitDingbats')).toBe(true);
  });

  it('makes no network requests at all while rendering ordinary PDFs', async () => {
    await readPdfInfo(fixture('text')); // pdf.js and its worker are loaded
    performance.clearResourceTimings();
    for (const name of ['mixed', 'encryptedOwner'] as const) {
      const file = fixture(name);
      await readPdfInfo(file);
      await renderThumbnails(file, 120, (_, bitmap) => bitmap.close());
    }
    close(await renderAll(await hundredPagePdf(), 24));
    expect(performance.getEntriesByType('resource').map((e) => e.name)).toEqual([]);
  });
});
