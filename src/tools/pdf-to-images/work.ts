// What saving one page does: draw it with pdf.js (renderPageImage, main thread + pdf.js worker),
// then encode the PNG as a normal image job on the shared queue (image worker).
import type { ImageFormat, ImageJobInput, ImageJobResult } from '@/core/contracts/image';
import { renderPageImage } from '@/engines/pdf/render';
import { runQueued, type QueueLike } from '@/tools/_shared';
import type { PageWork } from './runner';
import { pageJobInput, type PdfToImagesSettings } from './settings';
import { pdfToImagesStrings as t } from './strings';

/** One saved page. */
export interface PageOutput {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  format: ImageFormat;
  /** DPI used (lower than asked when `reduced`). */
  dpi: number;
  /** Drawn smaller because of the device's pixel limit. */
  reduced: boolean;
}

/** Share of a page's progress bar taken by drawing it (the rest is encoding). */
export const RENDER_SHARE = 0.3;

/** The page couldn't be drawn (damaged page, out of memory…). */
export class PageRenderFailed extends Error {
  constructor(cause: unknown) {
    super(t.renderFailed, { cause });
    this.name = 'PageRenderFailed';
  }
}

export interface PageWorkOptions {
  file: Blob;
  pdfName: string;
  dpi: number;
  settings: Pick<PdfToImagesSettings, 'format' | 'qualityMode' | 'quality'>;
  queue: QueueLike;
  /** Renders a page (tests pass a fake). */
  render?: typeof renderPageImage;
}

export function pageWork(o: PageWorkOptions): PageWork<PageOutput> {
  const render = o.render ?? renderPageImage;
  return async (page, { signal, stage, progress }) => {
    stage('rendering');
    let image;
    try {
      image = await render(o.file, page - 1, o.dpi, signal);
    } catch (error) {
      signal.throwIfAborted();
      throw new PageRenderFailed(error);
    }
    signal.throwIfAborted();
    progress(RENDER_SHARE);
    stage('encoding');

    const input = pageJobInput(image, `page-${page}.png`, o.settings);
    const job = runQueued<ImageJobInput, ImageJobResult>(
      o.queue,
      'image',
      'process',
      t.jobLabel(o.pdfName, page),
      input,
      (p) => progress(RENDER_SHARE + (1 - RENDER_SHARE) * p),
    );
    // Cancelling the page cancels its job; the queue then removes it.
    const cancel = () => o.queue.getState().cancel(job.id);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      const result = await job.done;
      return {
        blob: result.blob,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        format: result.format,
        dpi: image.dpi,
        reduced: image.reduced,
      };
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  };
}

/** The message shown on a page that failed. */
export function describePageError(error: unknown): string {
  if (error instanceof PageRenderFailed) return t.renderFailed;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return t.renderFailed;
}
