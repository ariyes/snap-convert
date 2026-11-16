import type {
  ImagesToPdfInput,
  MergeInput,
  NamedBlob,
  OrganizeInput,
  PdfResult,
  ResizePagesInput,
  SplitInput,
} from '@/core/contracts';
import type { Progress } from './draw';
import { PdfOpError } from './errors';
import { imagesToPdf } from './images-to-pdf';
import { mergePdfs } from './merge';
import type { PdfOp } from './op-names';
import { organizePdf } from './organize';
import { resizePages } from './resize-pages';
import { splitPdf } from './split';
import { pdfStrings } from './strings';

/**
 * Runs one PDF operation by name — what the PDF worker's `WorkerApi.run` calls. The input comes
 * from another thread, so its shape is checked before use; each operation checks its settings.
 */
export async function runPdfOp(
  op: string,
  input: unknown,
  onProgress?: Progress,
): Promise<PdfResult> {
  switch (op as PdfOp) {
    case 'images-to-pdf':
      check<ImagesToPdfInput>(input, (i) => isList(i.images, isNamedBlob) && isText(i.outName));
      return imagesToPdf(input, onProgress);
    case 'merge':
      check<MergeInput>(input, (i) => isList(i.files, isNamedBlob) && isText(i.outName));
      return mergePdfs(input, onProgress);
    case 'split':
      check<SplitInput>(input, (i) => isNamedBlob(i.file));
      return splitPdf(input, onProgress);
    case 'organize':
      check<OrganizeInput>(
        input,
        (i) => isNamedBlob(i.file) && isList(i.pages, isRecord) && isText(i.outName),
      );
      return organizePdf(input, onProgress);
    case 'resize-pages':
      check<ResizePagesInput>(input, (i) => isNamedBlob(i.file) && isText(i.outName));
      return resizePages(input, onProgress);
    default:
      throw new PdfOpError('bad-input', pdfStrings.unknownOp(op));
  }
}

function check<T>(input: unknown, ok: (i: Record<string, unknown>) => boolean): asserts input is T {
  if (!isRecord(input) || !ok(input)) throw new PdfOpError('bad-input', pdfStrings.badInput);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isText(x: unknown): x is string {
  return typeof x === 'string';
}

function isList(x: unknown, item: (x: unknown) => boolean): boolean {
  return Array.isArray(x) && x.every(item);
}

function isNamedBlob(x: unknown): x is NamedBlob {
  return isRecord(x) && x.blob instanceof Blob && typeof x.name === 'string';
}
