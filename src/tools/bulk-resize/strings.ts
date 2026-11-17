// User-facing text of the Bulk resize & compress page (P17). Wording from the prototype (D18).
// Shared text (Reset, Download, Save to folder …) comes from src/ui/strings.ts and the modules.

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** 512 B · 4.2 KB · 38 KB · 3.4 MB · 1.2 GB (as in the prototype). */
export function formatBytes(bytes: number): string {
  const b = Math.max(0, Math.round(bytes));
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

/** "about 40 s left" / "about 3 min left"; null seconds → "estimating time…". */
export function formatTimeLeft(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return bulkStrings.estimating;
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `about ${s} s left`;
  return `about ${Math.round(s / 60)} min left`;
}

export const bulkStrings = {
  // Empty state
  dropTitle: 'Drop as many images as you like',
  dropSubtitle: 'No limit on number or size. Folders work too.',
  trySamples: 'Try with 12 sample files',
  makingSamples: 'Making sample files…',
  samplesFailed: "Sample files couldn't be made in this browser. Try your own images instead.",

  // File list
  listLabel: 'Images to resize',
  fileCount: (n: number) => `${n} ${plural(n, 'file', 'files')}`,
  add: 'Add',
  addLabel: 'Add more images',
  clear: 'Clear',
  clearLabel: 'Remove all images',
  dropHere: 'Drop images to add them',
  waiting: 'Waiting',
  progressLabel: (name: string) => `Resizing ${name}`,
  doneLabel: (size: string) => `Done, ${size}`,
  failed: 'Failed',
  cancelled: 'Cancelled',
  cancelledReason: 'Stopped before it finished.',
  retry: 'Retry',
  retryLabel: (name: string) => `Retry ${name}`,
  removeLabel: (name: string) => `Remove ${name}`,
  dims: 'Size',
  originalSize: 'Original file size',
  // Tags after the new dimensions
  notEnlarged: 'not enlarged',
  padded: 'padded',
  cropped: 'cropped',
  larger: 'larger than the original',
  keptOriginal: 'already small — kept the original',
  formatFallback: (format: string) => `saved as ${format}`,

  // Settings
  panelTitle: 'Settings for all files',

  // Run and summary
  run: (n: number) => `Resize ${n} ${plural(n, 'image', 'images')}`,
  working: 'Working…',
  downloadZip: 'Download ZIP',
  changeSettings: 'Change settings',
  cancel: 'Cancel',
  cancelLabel: 'Stop resizing',
  estimated: 'Estimated:',
  about: 'about',
  processing: (n: number) => `Processing ${n} at a time…`,
  estimating: 'estimating time…',
  overallProgress: 'Overall progress',
  done: (n: number) => `${n} done`,
  failedCount: (n: number) => `${n} failed`,
  cancelledCount: (n: number) => `${n} cancelled`,
  stale: 'Settings changed — resize again to apply them.',
  runStarted: (n: number) => `Resizing ${n} ${plural(n, 'image', 'images')}`,
  runFinished: (done: number, failed: number) =>
    failed > 0 ? `Finished: ${done} done, ${failed} failed` : `Finished: ${done} done`,

  // Export
  zipName: 'resized-images',

  // Leaving with results
  leaveTitle: 'Leave this page?',
  leaveUnsaved:
    "Your resized images haven't been downloaded yet. They are only kept on this page and will be lost if you leave.",
  leaveRunning: 'Images are still being resized. Leaving stops the work and loses the results.',
  stay: 'Stay',
  leave: 'Leave',
} as const;
