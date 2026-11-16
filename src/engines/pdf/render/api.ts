import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfInfo, ReadPdfInfo, RenderThumbnails } from '@/core/contracts/pdf';
import { withDocument } from './documents';
import { PdfRenderError } from './errors';
import { Limiter } from './limiter';
import { thumbnailCanvasSize, thumbnailLongSide } from './size';

/** At most this many pages render at once, across all files. */
export const MAX_CONCURRENT_RENDERS = 2;

export const renderSlots = new Limiter(MAX_CONCURRENT_RENDERS);

/**
 * Page count, encryption and page sizes in PDF points (1/72 in), as displayed: /Rotate is
 * applied (a rotated portrait page reports landscape), the CropBox is used and UserUnit included.
 * A password-protected file returns `{ pages: 0, encrypted: true, pageSizes: [] }`; a file that
 * opens without a password but has an owner password (permissions) returns its pages with
 * `encrypted: true`. Rejects with PdfRenderError('invalid') for files that aren't PDFs.
 */
export const readPdfInfo: ReadPdfInfo = async (file) => {
  try {
    return await withDocument(file, async (doc): Promise<PdfInfo> => {
      const [encrypted, pageSizes] = await Promise.all([
        isEncrypted(doc),
        Promise.all(
          Array.from({ length: doc.numPages }, async (_, i) => {
            const { width, height } = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
            return { width, height };
          }),
        ),
      ]);
      return { pages: doc.numPages, encrypted, pageSizes };
    });
  } catch (error) {
    if (error instanceof PdfRenderError && error.code === 'encrypted') {
      return { pages: 0, encrypted: true, pageSizes: [] };
    }
    throw error;
  }
};

async function isEncrypted(doc: PDFDocumentProxy): Promise<boolean> {
  const { info } = await doc.getMetadata();
  return 'EncryptFilterName' in info && info.EncryptFilterName != null;
}

/**
 * Renders every page, in order, to an ImageBitmap whose long side is `maxSize` CSS pixels times
 * the device pixel ratio (so it is crisp when shown at `maxSize` CSS px). `onPage` receives each
 * bitmap and owns it (call `bitmap.close()` when done). At most 2 pages render at once.
 * After `signal` aborts, rendering stops, `onPage` is never called again and the promise
 * rejects with the abort reason. If some pages fail, the others still render and the promise
 * then rejects with the first error. Password-protected files reject with PdfRenderError('encrypted').
 */
export const renderThumbnails: RenderThumbnails = async (file, maxSize, onPage, signal) => {
  signal?.throwIfAborted();
  const longSide = thumbnailLongSide(maxSize);
  await withDocument(file, async (doc) => {
    const jobs: Promise<void>[] = [];
    let firstError: { error: unknown } | undefined;
    try {
      for (let index = 0; index < doc.numPages; index++) {
        const release = await renderSlots.acquire(signal);
        const job = renderPage(doc, index, longSide, signal)
          .then((bitmap) => {
            if (signal?.aborted) bitmap.close();
            else onPage(index, bitmap);
          })
          .catch((error: unknown) => {
            firstError ??= { error };
          })
          .finally(release);
        jobs.push(job);
      }
    } finally {
      // Jobs never reject; after an abort they finish quickly (render tasks are cancelled).
      await Promise.all(jobs);
    }
    signal?.throwIfAborted();
    if (firstError) throw firstError.error;
  });
};

/**
 * Renders one page (0-based `pageIndex`) like renderThumbnails. For grids that render only the
 * pages on screen: abort the signal when a page scrolls away. Shares the 2-page limit and the
 * document cache with renderThumbnails.
 */
export async function renderPageThumbnail(
  file: Blob,
  pageIndex: number,
  maxSize: number,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  signal?.throwIfAborted();
  const longSide = thumbnailLongSide(maxSize);
  return withDocument(file, async (doc) => {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.numPages) {
      throw new RangeError(`Page ${pageIndex} is out of range (0–${doc.numPages - 1})`);
    }
    const release = await renderSlots.acquire(signal);
    try {
      return await renderPage(doc, pageIndex, longSide, signal);
    } finally {
      release();
    }
  });
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function renderPage(
  doc: PDFDocumentProxy,
  index: number,
  longSide: number,
  signal: AbortSignal | undefined,
): Promise<ImageBitmap> {
  const page = await doc.getPage(index + 1);
  signal?.throwIfAborted();
  const size = thumbnailCanvasSize(page.getViewport({ scale: 1 }), longSide);
  const canvas = createCanvas(size.width, size.height);
  const task = page.render({
    // pdf.js draws into any 2D canvas; its types only name HTMLCanvasElement.
    canvas: canvas as HTMLCanvasElement,
    viewport: page.getViewport({ scale: size.scale }),
    intent: 'display',
    background: 'rgb(255, 255, 255)',
  });
  const cancel = () => task.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    page.cleanup();
  }
  if (canvas instanceof HTMLCanvasElement) {
    const bitmap = await createImageBitmap(canvas);
    canvas.width = 0;
    return bitmap;
  }
  return canvas.transferToImageBitmap();
}
