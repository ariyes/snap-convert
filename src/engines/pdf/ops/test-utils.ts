// Helpers for the PDF browser tests only (never imported by app code).
import * as Comlink from 'comlink';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFPage } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { NamedBlob, PdfOutput, PdfResult, WorkerApi } from '@/core/contracts';

const fixtureUrls = import.meta.glob<string>('/tests/fixtures/pdf/*.pdf', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** A file from tests/fixtures/pdf as the operations receive it. */
export async function fixture(name: string): Promise<NamedBlob> {
  const url = fixtureUrls[`/tests/fixtures/pdf/${name}`];
  if (!url) throw new Error(`No fixture ${name}`);
  const blob = await (await fetch(url)).blob();
  return { blob: new Blob([blob], { type: 'application/pdf' }), name };
}

/** Starts the real PDF worker and wraps it with Comlink, as the job queue does. */
export function startPdfWorker(): { api: Comlink.Remote<WorkerApi>; worker: Worker } {
  const worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  return { api: Comlink.wrap<WorkerApi>(worker), worker };
}

/** Runs an operation in the worker; also returns every progress value it reported. */
export async function runInWorker(
  api: Comlink.Remote<WorkerApi>,
  op: string,
  input: unknown,
): Promise<{ result: PdfResult; progress: number[] }> {
  const progress: number[] = [];
  const result = (await api.run(
    op,
    input,
    Comlink.proxy((p: number) => {
      progress.push(p);
    }),
  )) as PdfResult;
  return { result, progress };
}

export async function open(output: PdfOutput | NamedBlob): Promise<PDFDocument> {
  return PDFDocument.load(new Uint8Array(await output.blob.arrayBuffer()), {
    updateMetadata: false,
  });
}

/** The decoded content stream(s) of a page as text. */
export function contentText(page: PDFPage): string {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => page.doc.context.lookup(ref))
      : [contents];
  return streams
    .map((s) =>
      s instanceof PDFRawStream
        ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode())
        : '',
    )
    .join('\n');
}

/** The `a b c d e f cm /Name Do` drawings on a page, as matrices. */
export function drawings(page: PDFPage): Array<{ name: string; m: number[] }> {
  const found: Array<{ name: string; m: number[] }> = [];
  const re = /((?:-?[\d.]+\s+){6})cm\s+\/(\S+)\s+Do/g;
  for (const match of contentText(page).matchAll(re)) {
    found.push({ name: match[2] ?? '', m: (match[1] ?? '').trim().split(/\s+/).map(Number) });
  }
  return found;
}

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

/** Text of each page as pdf.js extracts it (i.e. what a user can select and copy). */
export async function pageTexts(output: PdfOutput | NamedBlob): Promise<string[]> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await output.blob.arrayBuffer()),
  });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    texts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim(),
    );
  }
  await task.destroy();
  return texts;
}

/** Page size in points, rounded to 0.01 pt. */
export function sizeOf(page: PDFPage): [number, number] {
  const { width, height } = page.getSize();
  return [Math.round(width * 100) / 100, Math.round(height * 100) / 100];
}

/** A test image: a dark rectangle in the top-left corner on light grey, so orientation is visible. */
export async function makeImage(
  width: number,
  height: number,
  type: 'image/jpeg' | 'image/png',
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#123';
  ctx.fillRect(0, 0, width / 2, height / 4);
  // PNGs get a transparent corner, like a cut-out logo.
  if (type === 'image/png') ctx.clearRect(width / 2, height / 2, width / 2, height / 2);
  const blob = await canvas.convertToBlob({ type, quality: 0.9 });
  return new Uint8Array(await blob.arrayBuffer());
}

export function blobOf(bytes: Uint8Array, name: string): NamedBlob {
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>]), name };
}
