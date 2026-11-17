/** User-facing text of Split PDF (P19). */

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const splitStrings = {
  // Empty state
  dropTitle: 'Drop a PDF here',
  dropSubtitle: 'One PDF. You choose how to split it next.',
  trySample: 'Try with a sample PDF',

  // File card
  pages: (n: number) => plural(n, 'page', 'pages'),
  changeFile: 'Change PDF',
  removeFile: (name: string) => `Remove ${name}`,
  pagesLabel: 'Pages',
  pageLabel: (page: number) => `Page ${page}`,
  pageInParts: (page: number, part: number) => `Page ${page}, in part ${part}`,
  clickHint: 'Click pages to add or remove them',
  reading: 'Reading the PDF…',
  encrypted: "This PDF is password-protected — it can't be split.",
  unreadable: "This file can't be read — it may be damaged.",

  // Panel
  panelTitle: 'How to split',
  modeLabel: 'Split mode',
  modes: { 'every-page': 'Every page', 'every-n': 'Every N pages', ranges: 'Custom ranges' },
  everyN: 'Pages per part',
  rangesLabel: 'Pages for each part',
  rangesPlaceholder: '1-3, 5, 8-10',
  rangesHelp: 'Each range becomes its own PDF. Use commas between ranges.',
  partsPreview: (n: number) => `Makes ${plural(n, 'PDF', 'PDFs')}`,
  keptNote:
    "Bookmarks, form fields and links between pages aren't carried over; web links are kept.",
  splitting: 'Splitting…',
  progressLabel: 'Splitting progress',
  cancelled: 'Split cancelled.',
  split: (n: number) => (n === 1 ? 'Split into 1 PDF' : `Split into ${n} PDFs`),
  splitShort: 'Split',
  cancel: 'Cancel',

  // Results
  resultsTitle: (n: number) => `${plural(n, 'part', 'parts')} ready`,
  resultsLabel: 'Split PDFs',
  partPages: (n: number) => plural(n, 'page', 'pages'),
  downloadPart: (name: string) => `Download ${name}`,
  downloadPdf: 'Download PDF',
  downloadAllShort: 'All (ZIP)',
  zipping: (percent: number) => `Creating ZIP… ${percent}%`,
  zipSuffix: '-split',
  done: 'Split. Ready to download',
} as const;
