// User-facing text of the shared single-image screen (P15). Tool-specific text lives in each
// tool's own strings.ts; shared button text in src/ui/strings.ts.
import type { ImageFormat } from '@/core/contracts/image';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Format names as users know them. */
export const formatLabels: Record<ImageFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
};

export const singleImageStrings = {
  filesLabel: 'Your images',
  addImages: 'Add images',
  removeAll: 'Remove all',
  previewAlt: (name: string) => `Result for ${name}`,
  working: 'Working…',
  updating: 'Updating…',
  waiting: 'Waiting',
  failed: "Couldn't process this image",
  noPreview: 'No preview for this file yet',
  progress: (done: number, total: number) => `${done} of ${total} ready`,
  timeLeft: (seconds: number) =>
    seconds < 60
      ? `about ${Math.max(1, Math.round(seconds))} s left`
      : `about ${Math.round(seconds / 60)} min left`,
  failedCount: (n: number) => `${n} ${plural(n, 'image', 'images')} failed`,

  // Stats under the preview
  original: 'Original',
  result: 'New file',
  change: 'Change',
  sizeUnknown: '—',
  smaller: (percent: number) => `−${percent}%`,
  larger: (percent: number) => `+${percent}%`,
  same: 'Same',
  dims: (width: number, height: number) => `${width}×${height}`,

  // Result notes (D24, D28, D30): plain words, nothing alarming.
  notes: {
    keptOriginal: 'Your original was already well compressed, so it was kept as it is.',
    guardShort: 'Very grainy photo — kept the best quality possible.',
    notEnlarged: 'Already smaller than that size — not enlarged.',
    padded: 'Padded to the exact size, never stretched.',
    cropped: 'Edges trimmed to fill the exact size, never stretched.',
    formatFallback: (format: string) =>
      `Saved as ${format} — the original format can't be saved, so the closest one was used.`,
    metadataJpegOnly: 'Photo details can only be kept in JPG files, so they were removed.',
    larger: (format: string, resized: boolean) =>
      resized
        ? `Larger than the original — ${format} makes this image bigger. Try a lower quality or another format.`
        : `Larger than the original — ${format} at full size; try resizing.`,
    largerThanHeic: (format: string) =>
      `${format} files are bigger than HEIC photos — that’s normal, and they open anywhere.`,
  },

  zipName: (toolId: string) => `snap-convert-${toolId}`,
} as const;
