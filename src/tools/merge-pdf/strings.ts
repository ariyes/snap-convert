/** User-facing text of Merge PDF (P19). */

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const pagesText = (n: number) => plural(n, 'page', 'pages');

export const mergeStrings = {
  // Empty state
  dropTitle: 'Drop PDF files here',
  dropSubtitle: 'Add two or more. You can reorder them next.',
  trySamples: 'Try with 4 sample PDFs',

  // File grid
  listLabel: 'PDFs to merge, in order',
  pdfCount: (n: number) => plural(n, 'PDF', 'PDFs'),
  /** "· 37 pages · 9.7 MB"; `more` when some page counts aren't known yet. */
  totals: (pages: number, more: boolean, size: string) =>
    `· ${pages}${more ? '+' : ''} pages · ${size}`,
  dragHint: 'Drag to reorder',
  pagesShort: (n: number) => `${n} p`,
  pagesUnknown: 'pages: ?',
  pagesUnknownShort: '? p',
  moveEarlier: (name: string) => `Move ${name} earlier`,
  moveLater: (name: string) => `Move ${name} later`,
  remove: (name: string) => `Remove ${name}`,
  moved: (name: string, position: number, total: number) =>
    `${name} moved to position ${position} of ${total}`,
  removed: (name: string) => `${name} removed`,
  addPdfs: 'Add PDFs',
  encrypted: "Password-protected — can't be merged",
  unreadable: "Can't be read — it may be damaged",

  // Panel
  panelTitle: 'Merged file',
  fileName: 'File name',
  defaultName: 'merged',
  sizeNoteBefore: 'Pages keep their original size and quality. Use',
  sizeNoteLink: 'Resize PDF',
  sizeNoteAfter: 'to make every page the same size.',
  keptNote:
    "Bookmarks, form fields and links between pages aren't carried over; web links are kept.",
  needTwo: 'Add at least two PDFs to merge.',
  reading: 'Reading your PDFs…',
  merging: 'Merging…',
  progressLabel: 'Merging progress',
  cancelled: 'Merge cancelled.',
  merged: 'Merged. Ready to download',

  // Actions
  merge: (n: number) => `Merge ${n} PDFs`,
  download: 'Download PDF',
  cancel: 'Cancel',
} as const;
