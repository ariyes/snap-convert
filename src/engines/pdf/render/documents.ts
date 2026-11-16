import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { toPdfRenderError } from './errors';
import { IdleCache } from './idle-cache';

/** How long a loaded document stays open after its last use. */
export const DOCUMENT_CACHE_TTL_MS = 60_000;

/** pdf.js loads on first use only. */
const loadPdfjs = () => import('./pdfjs');

const documents = new IdleCache<Blob, Promise<PDFDocumentLoadingTask>>(
  DOCUMENT_CACHE_TTL_MS,
  (file) => loadPdfjs().then((pdfjs) => pdfjs.openDocument(file)),
  (loading) => {
    loading.then((task) => task.destroy()).catch(() => {});
  },
);

/**
 * Runs `task` with the parsed document for `file`. The document is parsed once and shared by
 * every caller, then destroyed 60 s after the last caller finishes.
 * Throws PdfRenderError for password-protected or unreadable files.
 */
export function withDocument<T>(
  file: Blob,
  task: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  return documents.use(file, async (loading) => {
    let doc: PDFDocumentProxy;
    try {
      doc = await (await loading).promise;
    } catch (error) {
      throw toPdfRenderError(error);
    }
    return task(doc);
  });
}

/** Whether a document for `file` is currently open (tests). */
export function isDocumentCached(file: Blob): boolean {
  return documents.has(file);
}

/** Destroys every cached document now (tests). */
export function clearDocumentCache(): void {
  documents.clear();
}
