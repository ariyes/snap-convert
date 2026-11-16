import type { PdfResult, ResizePagesInput } from '@/core/contracts';
import { drawXObject, type Progress } from './draw';
import { baseName, copyDocumentInfo, loadPdf, newPdf, pdfName, prepareForEmbed, savePdf } from './load';
import { orientPage, pageSizePoints } from './page-size';
import { fitInBox } from './placement';
import { normalizeRotation, pageMatrix, rotatedSize } from './transforms';

/**
 * Puts every page on a new page size: the visible page is scaled uniformly to fit (up or down),
 * centred, never stretched. Pages are embedded as vector drawings, so text stays text.
 * `orientation: 'auto'` makes each new page portrait or landscape to match the old one.
 * A page's rotation is applied to the drawing, so it looks the same as before.
 * Links, form fields and other annotations are dropped (pdf-lib embeds only the drawing).
 */
export async function resizePages(input: ResizePagesInput, onProgress?: Progress): Promise<PdfResult> {
  const target = pageSizePoints(input.pageSize);
  const src = await loadPdf(input.file);
  onProgress?.(0.1);

  prepareForEmbed(src);
  const srcPages = src.getPages();
  const out = await newPdf();
  copyDocumentInfo(src, out);
  // The visible area is the crop box (the media box when there's none).
  const boxes = srcPages.map((page) => page.getCropBox());
  const embedded = await out.embedPages(
    srcPages,
    boxes.map((b) => ({ left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height })),
  );

  for (const [i, srcPage] of srcPages.entries()) {
    const content = embedded[i];
    const box = boxes[i];
    if (!content || !box) continue;
    const rotation = normalizeRotation(srcPage.getRotation().angle);
    const size = { width: box.width, height: box.height };
    const shown = rotatedSize(size, rotation);

    const pageSize = orientPage(target, input.orientation, shown);
    const { target: place, scale } = fitInBox(shown, pageSize, true);
    const page = out.addPage([pageSize.width, pageSize.height]);
    drawXObject(page, 'Page', content.ref, pageMatrix(rotation, size, scale, place.x, place.y));
    onProgress?.(0.1 + ((i + 1) / srcPages.length) * 0.85);
  }

  const file = await savePdf(out, pdfName(input.outName, baseName(input.file.name)));
  onProgress?.(1);
  return { files: [file] };
}
