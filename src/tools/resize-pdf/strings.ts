/** User-facing text of Resize PDF (P20). Shared button text lives in src/ui/strings.ts. */
import type { PageOrientation } from '@/core/contracts/pdf';
import type { SizeChoice, Unit } from './settings';

const pages = (n: number) => (n === 1 ? '1 page' : `${n} pages`);
const pdfs = (n: number) => (n === 1 ? '1 PDF' : `${n} PDFs`);

export const resizeStrings = {
  dropTitle: 'Drop PDF files here',
  dropSubtitle: 'PDF — one or more. Every page gets the same paper size.',
  addMore: 'Add more PDFs',

  // Panel
  panelTitle: 'Settings for all PDFs',
  pageSize: 'Page size',
  sizeNames: {
    a4: 'A4',
    letter: 'Letter',
    a5: 'A5',
    legal: 'Legal',
    custom: 'Custom',
  } satisfies Record<SizeChoice, string>,
  sizeOptions: {
    a4: 'A4 · 210 × 297 mm',
    letter: 'Letter · 8.5 × 11 in',
    a5: 'A5 · 148 × 210 mm',
    legal: 'Legal · 8.5 × 14 in',
    custom: 'Custom size…',
  } satisfies Record<SizeChoice, string>,
  width: 'Width',
  height: 'Height',
  unit: 'Unit',
  units: { mm: 'mm', in: 'in' } satisfies Record<Unit, string>,
  orientation: 'Orientation',
  orientations: {
    auto: 'Auto',
    portrait: 'Portrait',
    landscape: 'Landscape',
  } satisfies Record<PageOrientation, string>,
  orientationHelp: {
    auto: 'Each page keeps its own orientation.',
    portrait: 'Every page becomes portrait (tall).',
    landscape: 'Every page becomes landscape (wide).',
  } satisfies Record<PageOrientation, string>,
  limits:
    'Content is scaled to fit and centred — never stretched. Text stays selectable. Links and form fields are not kept.',

  // Preview
  previewTitle: 'Preview · first page',
  previewLabel: (name: string, size: string) =>
    `Preview: the first page of ${name} on the new ${size} page, scaled to fit and centred`,
  previewSize: (
    name: string,
    w: string,
    h: string,
    unit: Unit,
    orientation: 'portrait' | 'landscape',
  ) => `${name} · ${w} × ${h} ${unit} · ${orientation}`,
  previewScale: (percent: number) => `Content scaled to ${percent}%, centred`,
  previewEmpty: 'The preview shows once a PDF has been read.',

  // File list
  listCount: pdfs,
  listDetail: (totalPages: number, bytes: string) => `${pages(totalPages)} · ${bytes}`,
  sizeChange: (from: string, to: string) => `${from} → ${to}`,
  mixedSizes: 'mixed sizes',
  reading: 'Reading…',
  pagesCount: pages,
  encrypted: 'Password-protected',
  encryptedHelp: 'Remove the password in your PDF app, then add it again.',
  unreadable: "Couldn't open — the PDF may be damaged",
  waiting: 'Waiting',
  working: (percent: number) => `Resizing… ${percent}%`,
  done: 'Done',
  cancelled: 'Cancelled',
  failed: 'Failed',
  notYet: 'Not resized yet',
  remove: (name: string) => `Remove ${name}`,
  download: (name: string) => `Download ${name}`,
  progressLabel: (name: string) => `Resizing ${name}`,
  bytesChange: (before: string, after: string) => `${before} → ${after}`,

  // Running
  resize: (n: number) => `Resize ${pdfs(n)}`,
  resizing: (percent: number) => `Resizing… ${percent}%`,
  cancel: 'Cancel',
  noneToResize: 'Add a PDF that isn’t password-protected to resize it.',
  stillReading: 'Reading your PDFs…',
  resultTitle: (n: number) => (n === 1 ? 'Your PDF is ready' : `${n} PDFs are ready`),
  resultLine: (totalPages: number, bytes: string) => `${pages(totalPages)} · ${bytes}`,
  someFailed: (n: number) => `${pdfs(n)} couldn't be resized — see the list.`,
  zipName: 'resized-pdfs',
  outSuffix: (size: SizeChoice) => (size === 'custom' ? 'custom-size' : size),
  clearAll: 'Remove all',
} as const;
