/** User-facing text of the Images to PDF page (P18). Shared button text lives in src/ui/strings.ts. */
import type { PageOrientation } from '@/core/contracts/pdf';
import type { MarginChoice, PageSizeChoice, QualityChoice } from './settings';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const pages = (n: number) => `${n} ${plural(n, 'page', 'pages')}`;

export const strings = {
  // Drop zones
  dropTitle: 'Drop images here',
  dropSubtitle: 'JPG · PNG · HEIC · WebP · AVIF · GIF · BMP — one page per image',
  addMore: 'Add images',
  addMoreSubtitle: 'or drop them here',

  // List
  listLabel: 'Pages, in order',
  summary: (n: number) => `${n} ${plural(n, 'image', 'images')}`,
  summaryDetail: (n: number, size: string) => `${pages(n)} · ${size}`,
  dragHint: 'Drag to reorder',
  clearAll: 'Remove all',
  pageNumber: (n: number) => `Page ${n}:`,
  moveEarlier: (name: string) => `Move ${name} earlier`,
  moveLater: (name: string) => `Move ${name} later`,
  removeFile: (name: string) => `Remove ${name}`,
  moved: (name: string, position: number, total: number) =>
    `${name} moved to page ${position} of ${total}`,
  removed: (name: string) => `${name} removed`,
  dims: (width: number, height: number) => `${width} × ${height}`,
  sizeUnknown: 'size unknown',
  preparingPreview: 'Preparing preview…',
  previewLabel: (name: string, page: string) => `${name} on a ${page} page`,
  convertFailed: (name: string, reason: string) =>
    reason ? `“${name}” couldn't be prepared: ${reason}` : `“${name}” couldn't be prepared`,

  // Settings
  panelTitle: 'Settings for the PDF',
  pageSize: 'Page size',
  pageSizes: {
    a4: 'A4',
    letter: 'Letter',
    a5: 'A5',
    legal: 'Legal',
    'fit-image': 'Fit to image',
  } satisfies Record<PageSizeChoice, string>,
  pageSizeHelp: {
    a4: '210 × 297 mm',
    letter: '8.5 × 11 in',
    a5: '148 × 210 mm',
    legal: '8.5 × 14 in',
    'fit-image': 'Each page is the size of its image',
  } satisfies Record<PageSizeChoice, string>,
  orientation: 'Orientation',
  orientations: {
    auto: 'Auto',
    portrait: 'Portrait',
    landscape: 'Landscape',
  } satisfies Record<PageOrientation, string>,
  orientationHelp: 'Auto turns each page to match its image.',
  orientationFitImage: 'Not needed with Fit to image.',
  margin: 'Margin',
  margins: {
    none: 'None',
    small: 'Small',
    large: 'Large',
  } satisfies Record<MarginChoice, string>,
  marginHelp: 'Small is 10 mm, large is 20 mm around each image.',
  quality: 'Image quality',
  qualities: {
    original: 'Original',
    smaller: 'Smaller file',
  } satisfies Record<QualityChoice, string>,
  qualityHelp: {
    original: 'Images go in as they are. Best quality.',
    smaller: 'Resized to 2480 px and compressed. Good for email.',
  } satisfies Record<QualityChoice, string>,
  fileName: 'File name',
  defaultName: 'images',
  neverStretched:
    'Each image is fitted inside the margins and centred — never stretched. HEIC, WebP and AVIF become JPEG (or PNG) first.',

  // Page labels in the preview
  pageLabel: (size: PageSizeChoice, landscape: boolean) =>
    size === 'fit-image'
      ? 'Fit to image'
      : `${strings.pageSizes[size]} ${landscape ? 'landscape' : 'portrait'}`,

  // Building
  make: (n: number) => `Make PDF · ${pages(n)}`,
  makeShort: 'Make PDF',
  making: 'Making PDF…',
  makingPercent: (percent: number) => `Making your PDF… ${percent}%`,
  progressLabel: 'Making PDF',
  cancel: 'Cancel',
  cancelled: 'Stopped. Nothing was made.',
  downloadPdf: 'Download PDF',
  resultDetail: (n: number, size: string) => `${pages(n)} · ${size}`,
  resultBefore: (before: string, after: string) => `Images ${before} → PDF ${after}`,
  ready: 'Your PDF is ready',
  noPdf: 'No PDF was made. Please try again.',
  fixFiles: 'Remove the images marked with a problem, then try again.',
} as const;
