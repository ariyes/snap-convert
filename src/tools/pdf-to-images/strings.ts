/** User-facing text of PDF to images (P31). */

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const pdfToImagesStrings = {
  // Empty state
  dropTitle: 'Drop a PDF here',
  dropSubtitle: 'One PDF. Every page becomes a JPG or PNG.',
  trySample: 'Try with a sample PDF',

  // File card
  pages: (n: number) => plural(n, 'page', 'pages'),
  changeFile: 'Change PDF',
  removeFile: (name: string) => `Remove ${name}`,
  pagesLabel: 'Pages',
  pageLabel: (page: number) => `Page ${page}`,
  clickHint: 'Click pages to choose which ones to save',
  reading: 'Reading the PDF…',
  encrypted: "This PDF is password-protected — it can't be opened.",
  unreadable: "This file can't be read — it may be damaged.",

  // Panel
  panelTitle: 'Save pages as images',
  pagesHeading: 'Pages',
  pageModes: { all: 'All pages', choose: 'Choose pages' },
  rangesLabel: 'Pages to save',
  rangesPlaceholder: '1-3, 5, 8-10',
  rangesHelp: 'Use commas between pages and ranges, or click the pages.',
  picked: (n: number) => `${plural(n, 'page', 'pages')} chosen`,

  format: 'Format',
  formats: { jpeg: 'JPG', png: 'PNG' },
  formatHelp: {
    jpeg: 'Smaller files, text stays sharp.',
    png: 'Lossless: exactly as drawn. Larger files.',
  },

  resolution: 'Resolution',
  resolutions: { screen: 'Screen', standard: 'Standard', print: 'Print', custom: 'Custom' },
  resolutionHelp: {
    screen: '72 dpi — small files for viewing on screen.',
    standard: '150 dpi — sharp on screen and fine for printing at home.',
    print: '300 dpi — for printing and zooming in on small print.',
    custom: 'Any value from 36 to 600 dpi.',
  },
  customDpi: 'Dots per inch',
  dpiUnit: 'dpi',
  pageSize: (page: number, width: number, height: number) =>
    `Page ${page}: ${width} × ${height} px`,
  pageSizeCapped: (dpi: number) => ` — capped at ${dpi} dpi, the most this page can use`,

  quality: 'JPG quality',
  qualityModes: { auto: 'Auto', custom: 'Choose' },
  qualityAutoHelp: 'Picks the smallest file that still looks the same as the page.',
  qualityLevel: 'Quality',
  qualityHelp: 'Lower quality makes smaller files; below 70, small text can look smudged.',

  fileNames: 'File names',
  fileNamesTipLabel: 'About file names',
  fileNamesTip:
    'Words in curly brackets are filled in for each page: {name} PDF name, {n} page number, {width} and {height} image size, {format} file type.',
  fileNamesExample: 'e.g.',
  fileNamesTokens: 'use {name} {n} {width} {height} {format}',

  // Running
  run: (pages: number, format: string) =>
    pages === 1 ? `Save 1 page as ${format}` : `Save ${pages} pages as ${format}`,
  runShort: 'Save pages',
  saving: 'Saving…',
  cancel: 'Cancel',
  progress: (done: number, total: number) => `${done} of ${plural(total, 'page', 'pages')}`,
  progressLabel: 'Saving progress',
  cancelled: 'Stopped. Pages already saved are ready below.',
  jobLabel: (name: string, page: number) => `${name}, page ${page}`,

  // Results
  resultsTitle: (done: number, total: number) =>
    done === total
      ? `${plural(done, 'image', 'images')} ready`
      : `${done} of ${total} images ready`,
  resultsLabel: 'Saved pages',
  statusWaiting: 'Waiting',
  statusRendering: 'Drawing…',
  statusEncoding: 'Saving…',
  statusCancelled: 'Stopped',
  pageProgressLabel: (page: number) => `Saving page ${page}`,
  reducedDpi: (dpi: number) => `Saved at ${dpi} dpi — the largest this device can draw.`,
  download: (name: string) => `Download ${name}`,
  retry: 'Retry',
  retryLabel: (page: number) => `Retry page ${page}`,
  retryAll: 'Retry the rest',
  renderFailed: "This page couldn't be drawn.",
  zipSuffix: '-images',
  done: (n: number) => (n === 1 ? 'Saved. Ready to download' : `${n} images ready to download`),
} as const;
