import { degrees } from 'pdf-lib';
import type { OrganizeInput, PdfResult } from '@/core/contracts';
import type { Progress } from './draw';
import { PdfOpError } from './errors';
import { baseName, copyDocumentInfo, loadPdf, newPdf, pdfName, prepareForCopy, savePdf } from './load';
import { pdfStrings } from './strings';
import { normalizeRotation } from './transforms';

/**
 * Reorders, turns and deletes pages. `pages` lists the pages to keep (0-based `index`) in their
 * new order; `rotate` is added to each page's existing rotation. Pages are copied into a new
 * file, so deleted pages are really gone (not just hidden). Bookmarks, internal links and form
 * fields are dropped, as in merge.
 */
export async function organizePdf(input: OrganizeInput, onProgress?: Progress): Promise<PdfResult> {
  const src = await loadPdf(input.file);
  const count = src.getPageCount();
  if (input.pages.length === 0) throw new PdfOpError('bad-input', pdfStrings.noPagesKept);

  const used = new Set<number>();
  for (const { index, rotate } of input.pages) {
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new PdfOpError('bad-input', pdfStrings.pageMissing(Number.isInteger(index) ? index + 1 : String(index), count));
    }
    if (used.has(index)) throw new PdfOpError('bad-input', pdfStrings.pageTwice(index + 1));
    if (![0, 90, 180, 270].includes(rotate)) throw new PdfOpError('bad-input', pdfStrings.badRotation);
    used.add(index);
  }
  onProgress?.(0.1);

  prepareForCopy(src);
  const out = await newPdf();
  copyDocumentInfo(src, out);
  const pages = await out.copyPages(src, input.pages.map((p) => p.index));
  for (const [i, page] of pages.entries()) {
    const rotate = input.pages[i]?.rotate ?? 0;
    page.setRotation(degrees(normalizeRotation(page.getRotation().angle + rotate)));
    out.addPage(page);
    onProgress?.(0.1 + ((i + 1) / pages.length) * 0.85);
  }

  const file = await savePdf(out, pdfName(input.outName, baseName(input.file.name)));
  onProgress?.(1);
  return { files: [file] };
}
