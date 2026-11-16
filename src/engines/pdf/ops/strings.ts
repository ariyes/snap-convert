// User-facing messages from the PDF operations. They reach the UI as `Job.error` (through the
// worker), or directly from `parseRanges` for live validation of the split ranges field.

const pages = (n: number) => (n === 1 ? '1 page' : `${n} pages`);

/** `name` is shown only on this device, so the user knows which of several files failed. */
const which = (name?: string) => (name ? `“${name}”` : 'This PDF');

export const pdfStrings = {
  // Loading
  encrypted: (name?: string) =>
    name ? `“${name}” is password-protected` : 'This PDF is password-protected',
  damaged: (name?: string) => (name ? `“${name}” looks damaged` : 'This PDF looks damaged'),
  notPdf: (name?: string) => (name ? `“${name}” isn't a PDF file` : "This file isn't a PDF"),
  noPages: (name?: string) => `${which(name)} has no pages`,
  timeout: (name?: string) => `${which(name)} took too long to open — it may be damaged`,

  // Images to PDF
  noImages: 'Add at least one image',
  unsupportedImage: (name: string) =>
    `“${name}” can't go into a PDF as it is — only JPEG and PNG images can be added`,
  brokenImage: (name: string) => `“${name}” couldn't be read — the image may be damaged`,
  marginTooLarge: 'The margin is too large for this page size',
  badMargin: 'The margin must be 0 mm or more',
  badPageSize: 'Page width and height must be between 1 and 14,400 points (200 inches)',

  // Merge / organize / split
  noFiles: 'Add at least one PDF',
  noPagesKept: 'Keep at least one page',
  pageMissing: (page: number | string, total: number) =>
    `Page ${page} doesn't exist — this PDF has ${pages(total)}`,
  pageTwice: (page: number) => `Page ${page} is listed twice`,
  badRotation: 'Pages can only be turned by 90, 180 or 270 degrees',
  badEveryN: 'Enter how many pages each part should have (1 or more)',

  // parseRanges
  rangesEmpty: 'Enter the pages you want, like 1-3, 5, 8-10',
  rangesJunk: (part: string) => `“${part}” isn't a page or range — use numbers like 1-3, 5, 8-10`,
  rangesZero: 'Page numbers start at 1',
  rangesBackwards: (from: number, to: number) =>
    `“${from}-${to}” is backwards — write it as ${to}-${from}`,

  // Worker
  unknownOp: (op: string) => `Unknown PDF operation “${op}”`,
  badInput: 'The PDF settings are incomplete',
} as const;
