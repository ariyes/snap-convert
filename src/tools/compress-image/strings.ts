// User-facing text of the Compress image page (P14). Shared control text lives in the shared
// modules' own strings (image settings, layout, export, src/ui/strings.ts).

/** Format names as users know them. */
export const formatLabels = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
} as const;

export const compressStrings = {
  // Empty state
  trySample: 'Try with a sample photo',
  sampleFailed: "The sample photo couldn't be loaded. Please try again.",

  // Stage
  filesLabel: 'Your images',
  thumbsLabel: 'Choose an image to preview',
  addImages: 'Add images',
  remove: 'Remove',
  removeLabel: (name: string) => `Remove ${name}`,
  statsLabel: 'Result',
  original: 'Original',
  newSize: 'New size',
  saved: 'Saved',
  savedNone: 'None',
  working: 'Compressing…',
  updating: 'Updating preview…',
  failed: 'Failed',
  dims: (width: number, height: number) => `${width}×${height}`,
  dimsLabel: 'New dimensions',
  progress: (done: number, total: number) => `Compressed ${done} of ${total}`,
  timeLeft: (seconds: number) =>
    seconds < 60
      ? `about ${Math.max(1, Math.round(seconds))} s left`
      : `about ${Math.round(seconds / 60)} min left`,
  progressLabel: 'Compression progress',
  failedCount: (n: number) => (n === 1 ? '1 image failed' : `${n} images failed`),
  retry: 'Try again',

  // Notes on a result (D24, D28, D30)
  keptOriginal: 'Your original was already well compressed — kept it.',
  keptOriginalStripped:
    'Your original was already well compressed — kept it (location data removed).',
  guardShort: 'Very grainy photo — kept the best quality possible.',
  biggerAtFullSize: (format: string) =>
    `Larger than the original — ${format} at full size. Try resizing.`,
  bigger: 'Larger than the original. Try a lower quality or Same as original.',
  targetUnreachable: (kb: number, width: number, height: number) =>
    `Can't reach ${kb} KB at ${width}×${height} without making it look worse. Smaller dimensions get there.`,
  targetUnreachableFormat: (kb: number) =>
    `Can't reach ${kb} KB as a PNG. A smaller format or smaller dimensions get there.`,
  resizeTo: (px: number) => `Resize to ${px} px`,
  switchTo: (format: string) => `Switch to ${format}`,
  formatFallback: (format: string) =>
    `Saved as ${format}: the original format can't be saved again in the browser.`,
  cantShowOriginal: "This browser can't show the original file, so both sides show the result.",

  // Downloads
  downloadAllShort: 'All (ZIP)',
  zipName: 'snap-convert-compressed',
  zipping: (percent: number) => `Creating ZIP… ${percent}%`,
  nameSuffix: '-compressed',
} as const;
