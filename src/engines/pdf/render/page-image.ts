// One PDF page saved as an image (P31, PDF-06): drawn at a chosen DPI with pdf.js, returned as a
// lossless PNG. Encoding to JPG/PNG happens afterwards in the image worker, as a normal image job.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderSlots } from './api';
import { withDocument } from './documents';
import { PAGE_IMAGE_LIMITS, pageImageSize } from './page-image-size';

export interface PageImage {
  /** Lossless PNG of the page, white background. */
  blob: Blob;
  width: number;
  height: number;
  /** DPI actually used (lower than asked for when `reduced`). */
  dpi: number;
  /** Drawn at a lower DPI because of this device's pixel limit. */
  reduced: boolean;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type CanvasFactory = (width: number, height: number) => AnyCanvas;

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Gives a canvas's memory back at once instead of waiting for garbage collection. */
function freeCanvas(canvas: AnyCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

// ---------- the device's canvas limit ----------

/**
 * Canvas sizes tried, largest first: each is as long as the longest side we draw and holds the
 * pixel limit, so one success proves both. 16384 × 3051 ≈ 50 MP; 16384 × 976 ≈ 16 MP.
 */
const PROBES = [
  { pixels: PAGE_IMAGE_LIMITS.maxPixels, width: PAGE_IMAGE_LIMITS.maxSide, height: 3051 },
  { pixels: PAGE_IMAGE_LIMITS.smallDevicePixels, width: PAGE_IMAGE_LIMITS.maxSide, height: 976 },
] as const;

function context2d(canvas: AnyCanvas, options?: CanvasRenderingContext2DSettings) {
  return canvas instanceof HTMLCanvasElement
    ? canvas.getContext('2d', options)
    : canvas.getContext('2d', options);
}

/** Whether a canvas this big really works: it has a 2D context and its far corner can be read back. */
function canvasWorks(create: CanvasFactory, width: number, height: number): boolean {
  let canvas: AnyCanvas | undefined;
  try {
    canvas = create(width, height);
    if (canvas.width !== width || canvas.height !== height) return false;
    const ctx = context2d(canvas);
    if (!ctx) return false;
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const [r, g, b, a] = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    return r === 255 && g === 0 && b === 0 && a === 255;
  } catch {
    return false;
  } finally {
    if (canvas) freeCanvas(canvas);
  }
}

/**
 * Most pixels this browser can draw a page with: 50 MP, or 16 MP where a 50 MP canvas fails
 * (iPhone Safari). Tries real canvases, largest first; the smallest limit is used if all fail.
 */
export function probeCanvasPixelLimit(create: CanvasFactory = createCanvas): number {
  for (const probe of PROBES) {
    if (canvasWorks(create, probe.width, probe.height)) return probe.pixels;
  }
  return PAGE_IMAGE_LIMITS.smallDevicePixels;
}

let pixelLimit: number | undefined;

/** {@link probeCanvasPixelLimit}, run once per visit (the first time a page is saved). */
export function canvasPixelLimit(): number {
  pixelLimit ??= probeCanvasPixelLimit();
  return pixelLimit;
}

/** Forgets (or, for tests, sets) the probed limit. */
export function resetCanvasPixelLimit(value?: number): void {
  pixelLimit = value;
}

// ---------- rendering ----------

async function toPng(canvas: AnyCanvas): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The page could not be saved.'))),
        'image/png',
      );
    });
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

async function drawPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  dpi: number,
  signal: AbortSignal | undefined,
): Promise<PageImage> {
  const page = await doc.getPage(pageIndex + 1);
  try {
    signal?.throwIfAborted();
    const size = pageImageSize(page.getViewport({ scale: 1 }), dpi, canvasPixelLimit());
    const canvas = createCanvas(size.width, size.height);
    try {
      // Claim the 2D context first, with transparency allowed. pdf.js would otherwise ask for an
      // opaque one, where Chrome smooths text with coloured (LCD subpixel) edges: fine on this
      // screen, but coloured fringes in a saved image. The page background is still white.
      if (!context2d(canvas, { alpha: true, willReadFrequently: true })) {
        throw new Error('No 2D canvas context');
      }
      const task = page.render({
        // pdf.js draws into any 2D canvas; its types only name HTMLCanvasElement.
        canvas: canvas as HTMLCanvasElement,
        viewport: page.getViewport({ scale: size.scale }),
        // As printed: annotations meant for paper (stamps, filled-in form fields) are drawn,
        // screen-only ones are not, and optional content uses its print setting.
        intent: 'print',
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
      }
      signal?.throwIfAborted();
      const blob = await toPng(canvas);
      signal?.throwIfAborted();
      return {
        blob,
        width: size.width,
        height: size.height,
        dpi: size.dpi,
        reduced: size.reduced,
      };
    } finally {
      freeCanvas(canvas);
    }
  } finally {
    page.cleanup();
  }
}

/**
 * Draws page `pageIndex` (0-based) at `dpi` and returns it as a lossless PNG with a white
 * background. Size = page size in points × dpi / 72, both sides from one scale (as displayed:
 * /Rotate applied, so a rotated page comes out landscape). Above this device's pixel limit
 * (50 MP, or 16 MP where the browser can't make a canvas that big) or 16384 px on a side, the
 * largest DPI that fits is used and `reduced` is set.
 *
 * Shares the 2-page render limit and the document cache with the thumbnails; the canvas is freed
 * as soon as the PNG is made. Aborting `signal` cancels the render and rejects with the abort
 * reason. Password-protected files reject with PdfRenderError('encrypted').
 */
export async function renderPageImage(
  file: Blob,
  pageIndex: number,
  dpi: number,
  signal?: AbortSignal,
): Promise<PageImage> {
  signal?.throwIfAborted();
  if (!(dpi > 0) || !Number.isFinite(dpi)) {
    throw new RangeError(`DPI must be a positive number, got ${dpi}`);
  }
  return withDocument(file, async (doc) => {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.numPages) {
      throw new RangeError(`Page ${pageIndex} is out of range (0–${doc.numPages - 1})`);
    }
    const release = await renderSlots.acquire(signal);
    try {
      return await drawPage(doc, pageIndex, dpi, signal);
    } finally {
      release();
    }
  });
}
