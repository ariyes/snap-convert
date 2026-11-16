// M8 PDF engine — public entry for the main thread.
//
// P07: the PDF operations (images to PDF, merge, split, organize, resize pages) run inside the
// PDF worker (`./worker.ts`), reached through the job queue as `pdf` jobs with one of `PDF_OPS`
// as the op. Only pdf-lib-free helpers are exported here, so importing this module never pulls
// pdf-lib into the main bundle.
export { PDF_OPS, type PdfOp } from './ops/op-names';
export { parseRanges } from './ops/ranges';
export {
  NAMED_PAGE_SIZES,
  MAX_PAGE_POINTS,
  mmToPoints,
  orientPage,
  pageSizePoints,
} from './ops/page-size';
export { PdfOpError, type PdfErrorCode } from './ops/errors';
export { pdfStrings } from './ops/strings';

// P08
// pdf.js reading and page thumbnails, on the main thread. pdf.js itself loads on first use
// (dynamic import), so these exports keep it out of the startup bundle.
export {
  DOCUMENT_CACHE_TTL_MS,
  MAX_CONCURRENT_RENDERS,
  PdfRenderError,
  readPdfInfo,
  renderPageThumbnail,
  renderThumbnails,
  usePageThumbnail,
  useThumbnails,
  type PageThumbnailResult,
  type PdfRenderErrorCode,
  type ThumbnailsResult,
} from './render';
