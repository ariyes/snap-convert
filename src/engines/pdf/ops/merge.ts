import type { PDFDocument } from 'pdf-lib';
import type { MergeInput, PdfResult } from '@/core/contracts';
import type { Progress } from './draw';
import { PdfOpError } from './errors';
import { loadPdf, newPdf, pdfName, prepareForCopy, savePdf } from './load';
import { pdfStrings } from './strings';

/**
 * Copies every page of every file, in order. Page sizes, rotation, content, web links and
 * other annotations are kept. Bookmarks (outline), internal links and form fields are dropped:
 * pdf-lib can't carry them across documents safely.
 */
export async function mergePdfs(input: MergeInput, onProgress?: Progress): Promise<PdfResult> {
  if (input.files.length === 0) throw new PdfOpError('bad-input', pdfStrings.noFiles);

  // Load (and check) every file first, so a bad file fails before any work is done.
  const sources: PDFDocument[] = [];
  for (const [i, file] of input.files.entries()) {
    sources.push(await loadPdf(file, { nameInErrors: true }));
    onProgress?.(((i + 1) / input.files.length) * 0.2);
  }

  const total = sources.reduce((sum, doc) => sum + doc.getPageCount(), 0);
  const out = await newPdf();
  let done = 0;
  for (const src of sources) {
    prepareForCopy(src);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) {
      out.addPage(page);
      done++;
      onProgress?.(0.2 + (done / total) * 0.75);
    }
  }

  const file = await savePdf(out, pdfName(input.outName, 'merged'));
  onProgress?.(1);
  return { files: [file] };
}
