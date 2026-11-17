// M8 PDF engine — reading and page thumbnails (P08), using pdf.js.
// Nothing here imports pdf.js statically: it loads on the first call (see ./documents.ts).
export { MAX_CONCURRENT_RENDERS, readPdfInfo, renderPageThumbnail, renderThumbnails } from './api';
export { DOCUMENT_CACHE_TTL_MS } from './documents';
export { PdfRenderError, type PdfRenderErrorCode } from './errors';
// P31: one page saved as a PNG at a chosen DPI (encoded to JPG/PNG afterwards in the image worker).
export { renderPageImage, type PageImage } from './page-image';
export { PAGE_IMAGE_LIMITS, pageImageSize, type PageImageSize } from './page-image-size';
export {
  usePageThumbnail,
  useThumbnails,
  type PageThumbnailResult,
  type ThumbnailsResult,
} from './hooks';
