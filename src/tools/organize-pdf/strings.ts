/** User-facing text of Organize pages (P20). Shared button text lives in src/ui/strings.ts. */

const pages = (n: number) => (n === 1 ? '1 page' : `${n} pages`);

/** 1234567 → "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export const organizeStrings = {
  dropTitle: 'Drop a PDF here',
  dropSubtitle: 'PDF — one file. You can reorder, rotate and delete its pages next.',
  reading: 'Reading pages…',

  // File problems
  encrypted:
    'This PDF is password-protected. Remove the password in your PDF app, then add it again.',
  unreadable: "This PDF couldn't be opened. It may be damaged.",
  noPagesInFile: 'This PDF has no pages.',
  chooseAnother: 'Choose another PDF',

  // Grid
  gridLabel: 'Pages. Use arrow keys to move, Space to select.',
  summary: (count: number, original: number) =>
    count === original ? pages(count) : `${pages(count)} (of ${original})`,
  selectedCount: (n: number) => (n === 0 ? 'None selected' : `${n} selected`),
  dragHint: 'Drag to reorder',
  /** Read after the caption ("Page 5") by screen readers. */
  pageDetails: (position: number, rotate: number) =>
    `, position ${position}${rotate ? `, turned ${rotate}°` : ''}`,
  pageCaption: (original: number) => `Page ${original}`,
  turned: (rotate: number) => `${rotate}°`,
  dragCount: (n: number) => (n === 1 ? 'Moving 1 page' : `Moving ${n} pages`),
  allDeleted: 'Every page is deleted. Undo to bring pages back.',

  // Toolbar
  toolbarLabel: 'Page actions',
  selectAll: 'Select all',
  selectNone: 'Select none',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  moveStart: 'Move to start',
  moveEnd: 'Move to end',
  deletePages: 'Delete',
  undo: 'Undo',
  redo: 'Redo',
  shortcut: (label: string, keys: string) => `${label} (${keys})`,

  // Announcements (screen readers)
  announceRotated: (n: number) => `${pages(n)} rotated`,
  announceDeleted: (n: number) => `${pages(n)} deleted`,
  announceMoved: (n: number) => `${pages(n)} moved`,
  announceUndo: 'Undone',
  announceRedo: 'Redone',
  announceNothingToUndo: 'Nothing to undo',
  announceNothingToRedo: 'Nothing to redo',

  // Panel
  panelTitle: 'Organize',
  fileName: 'File name',
  nameSuffix: '-organized',
  keysTitle: 'Selecting pages',
  keysMouse: 'Click a page to select it. Ctrl/⌘-click adds pages, Shift-click selects a range.',
  keysTouch: 'On a touch screen, press and hold a page, then tap more pages.',
  keysKeyboard:
    'Keyboard: arrows move, Space selects, Shift + arrows extend, Alt + arrows move pages, Delete removes. Ctrl/⌘ + Z undoes, Ctrl/⌘ + Shift + Z redoes.',
  limits: 'Bookmarks, form fields and links inside the document are not kept. Web links are kept.',
  removeFile: 'Remove this PDF',

  // Running
  save: 'Save PDF',
  saving: (percent: number) => `Saving… ${percent}%`,
  cancel: 'Cancel',
  savingLabel: 'Saving progress',
  cancelled: 'Cancelled. Nothing was saved.',
  noPagesKept: 'Keep at least one page to save a PDF.',
  done: 'Your PDF is ready',
  resultLine: (count: number, before: string, after: string) =>
    `${pages(count)} · ${before} → ${after}`,
  failed: 'Saving failed',
  retry: 'Try again',
} as const;
