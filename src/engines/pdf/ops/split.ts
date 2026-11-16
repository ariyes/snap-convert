import type { PdfOutput, PdfResult, SplitInput } from '@/core/contracts';
import type { Progress } from './draw';
import { PdfOpError } from './errors';
import { baseName, copyDocumentInfo, loadPdf, newPdf, prepareForCopy, savePdf } from './load';
import { parseRanges } from './ranges';
import { pdfStrings } from './strings';

/**
 * Splits one PDF into parts: every page, every `n` pages, or custom `ranges` ("1-3, 5, 8-10").
 * Parts are named after the file and their pages: report-p1-3.pdf, report-p5.pdf.
 */
export async function splitPdf(input: SplitInput, onProgress?: Progress): Promise<PdfResult> {
  const src = await loadPdf(input.file);
  const count = src.getPageCount();
  const groups = pageGroups(input, count);
  onProgress?.(0.1);

  prepareForCopy(src);
  const base = baseName(input.file.name);
  const total = groups.reduce((sum, g) => sum + g.length, 0);
  const files: PdfOutput[] = [];
  let done = 0;
  for (const group of groups) {
    const out = await newPdf();
    copyDocumentInfo(src, out);
    const pages = await out.copyPages(
      src,
      group.map((n) => n - 1),
    );
    for (const page of pages) out.addPage(page);
    const first = group[0] ?? 1;
    const last = group[group.length - 1] ?? first;
    files.push(await savePdf(out, `${base}-p${first === last ? first : `${first}-${last}`}.pdf`));
    done += group.length;
    onProgress?.(0.1 + (done / total) * 0.9);
  }
  return { files };
}

/** 1-based page numbers for each part. */
function pageGroups(input: SplitInput, count: number): number[][] {
  const all = Array.from({ length: count }, (_, i) => i + 1);
  switch (input.mode) {
    case 'every-page':
      return all.map((n) => [n]);
    case 'every-n': {
      const n = input.n;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
        throw new PdfOpError('bad-input', pdfStrings.badEveryN);
      }
      const groups: number[][] = [];
      for (let i = 0; i < count; i += n) groups.push(all.slice(i, i + n));
      return groups;
    }
    case 'ranges':
      return parseRanges(input.ranges ?? '', count);
    default:
      throw new PdfOpError('bad-input', pdfStrings.badInput);
  }
}
