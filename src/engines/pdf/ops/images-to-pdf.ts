import type { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import type { ImagesToPdfInput, PdfResult, Size } from '@/core/contracts';
import { PdfOpError } from './errors';
import { jpegOrientation, sniffImageType } from './image-bytes';
import { newPdf, pdfName, savePdf } from './load';
import { MAX_PAGE_POINTS, mmToPoints, orientPage, pageSizePoints } from './page-size';
import { fitInBox } from './placement';
import { pdfStrings } from './strings';
import { imageMatrix, orientedSize } from './transforms';
import { drawXObject, type Progress } from './draw';

/**
 * One image per page, fitted and centred inside the margins — never stretched.
 *
 * - Only JPEG and PNG can go into a PDF. The caller converts WebP, AVIF, HEIC and others to
 *   JPEG (or PNG when transparent) before calling this.
 * - JPEG bytes are embedded unchanged (no re-encoding, so no quality loss). Their EXIF
 *   orientation is applied by how the image is drawn, since PDF viewers ignore EXIF.
 * - PNG is embedded losslessly (pdf-lib stores the pixels with Flate compression).
 * - `fit-image`: the page is the image size at 72 dpi (1 px = 1 pt) plus the margins, scaled
 *   down to stay within 200 inches. `orientation` is ignored for it.
 * - Other sizes: `orientation: 'auto'` makes each page portrait or landscape to match its image.
 *   Images are scaled up or down to fill the space inside the margins.
 */
export async function imagesToPdf(input: ImagesToPdfInput, onProgress?: Progress): Promise<PdfResult> {
  if (input.images.length === 0) throw new PdfOpError('bad-input', pdfStrings.noImages);
  if (!Number.isFinite(input.marginMm) || input.marginMm < 0) {
    throw new PdfOpError('bad-input', pdfStrings.badMargin);
  }
  const margin = mmToPoints(input.marginMm);
  const fixedPage = input.pageSize === 'fit-image' ? null : pageSizePoints(input.pageSize);

  const doc = await newPdf();
  for (const [i, image] of input.images.entries()) {
    const { embedded, orientation } = await embedImage(doc, image.blob, image.name);
    const shown = orientedSize(embedded, orientation);

    let pageSize: Size;
    let placement: ReturnType<typeof fitInBox>;
    if (fixedPage) {
      pageSize = orientPage(fixedPage, input.orientation, shown);
      placement = fitInBox(shown, contentBox(pageSize, margin), true);
    } else {
      // Image at 1 pt per pixel, shrunk only if the page would pass the 200-inch limit.
      const limit = MAX_PAGE_POINTS - 2 * margin;
      if (limit < 1) throw new PdfOpError('bad-input', pdfStrings.marginTooLarge);
      placement = fitInBox(shown, { width: limit, height: limit }, false);
      pageSize = { width: placement.target.width + 2 * margin, height: placement.target.height + 2 * margin };
      placement = fitInBox(shown, contentBox(pageSize, margin), false);
    }

    const page: PDFPage = doc.addPage([pageSize.width, pageSize.height]);
    const box = { ...placement.target, x: placement.target.x + margin, y: placement.target.y + margin };
    drawXObject(page, 'Image', embedded.ref, imageMatrix(orientation, box));
    onProgress?.((i + 1) / (input.images.length + 1));
  }

  const file = await savePdf(doc, pdfName(input.outName, 'images'));
  onProgress?.(1);
  return { files: [file] };
}

function contentBox(page: Size, margin: number): Size {
  const width = page.width - 2 * margin;
  const height = page.height - 2 * margin;
  if (width < 1 || height < 1) throw new PdfOpError('bad-input', pdfStrings.marginTooLarge);
  return { width, height };
}

async function embedImage(
  doc: PDFDocument,
  blob: Blob,
  name: string,
): Promise<{ embedded: PDFImage; orientation: number }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new PdfOpError('bad-image', pdfStrings.unsupportedImage(name));
  try {
    if (type === 'jpeg') {
      return { embedded: await doc.embedJpg(bytes), orientation: jpegOrientation(bytes) };
    }
    return { embedded: await doc.embedPng(bytes), orientation: 1 };
  } catch (_) {
    throw new PdfOpError('bad-image', pdfStrings.brokenImage(name));
  }
}
