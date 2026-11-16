/**
 * The only file that imports pdf.js. It is loaded with dynamic import() (see ./documents.ts),
 * so pdf.js and its worker never land in the startup bundle.
 *
 * We use the legacy build: same API, but it polyfills the very new JS features the modern build
 * relies on (e.g. Map#getOrInsertComputed), which older iPhone and Android browsers lack.
 */
import {
  getDocument,
  GlobalWorkerOptions,
  PDFWorker,
  VerbosityLevel,
  type PDFDocumentLoadingTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { bundledAssetUrl } from './assets';

// Served from our own build output, never a CDN.
GlobalWorkerOptions.workerSrc = workerUrl;

let sharedWorker: PDFWorker | undefined;

/** One pdf.js worker thread for every open document; it is never destroyed with a document. */
function pdfWorker(): PDFWorker {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new PDFWorker();
  return sharedWorker;
}

/**
 * Hands pdf.js the CMaps, fonts and wasm decoders it asks for from our bundled copies
 * (see ./assets.ts). pdf.js calls this on the main thread because `useWorkerFetch` is off.
 */
class BundledBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = bundledAssetUrl(kind, filename);
    if (!url) throw new Error(`pdf.js data file not bundled: ${kind} ${filename}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`pdf.js data file failed to load: ${kind} ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export async function openDocument(file: Blob): Promise<PDFDocumentLoadingTask> {
  const data = new Uint8Array(await file.arrayBuffer());
  return getDocument({
    data, // transferred to the worker
    worker: pdfWorker(),
    verbosity: VerbosityLevel.ERRORS,
    // No URLs at all: pdf.js can't build network requests (or CSS `url()` font sources) from them.
    // Data files come only from BundledBinaryDataFactory.
    useWorkerFetch: false,
    BinaryDataFactory: BundledBinaryDataFactory,
    // Security. `isEvalSupported` no longer exists: pdf.js 6 never compiles code with eval or
    // new Function. Scripting needs pdf.js's separate sandbox build, which we never load, and we
    // render to a canvas only (no annotation layer), so links and form actions are never active.
    enableXfa: false,
    // Pages render on this thread into OffscreenCanvas; parsing runs in the pdf.js worker.
    disableWorkerRendering: true,
  });
}
