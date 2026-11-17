// User-facing text of the Optimize for web page (P16). Shared button text is in src/ui/strings.ts.
import type { PresetId } from '@/engines/optimize';
import type { WebFormat } from './settings';

/** Format names as users know them. */
export const formatNames: Record<WebFormat, string> = { jpeg: 'JPG', webp: 'WebP', avif: 'AVIF' };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const optimizeStrings = {
  description: 'Pick where your images are going. You get small, sharp, private files.',
  dropTitle: 'Drop images for your website',
  dropMore: 'Add more images',

  // Destination cards
  destinationTitle: 'Where will the images go?',
  destinationLabel: 'Destination',
  destinations: {
    web: 'Website (general)',
    wordpress: 'WordPress',
    shopify: 'Shopify',
    blog: 'Blog hero',
    email: 'Email',
    thumbnail: 'Thumbnail',
  } satisfies Record<PresetId, string>,
  /** Small line on each card, e.g. "1920 px · JPG". */
  destinationSpec: (longestSide: number, format: WebFormat) =>
    `${longestSide} px · ${formatNames[format]}`,

  // Format
  formatTitle: 'Format',
  formatLabel: 'File format',
  formatHelp: {
    jpeg: 'Most compatible. Works everywhere.',
    webp: 'About 25% smaller, works in all modern browsers.',
    avif: 'Smallest files, but slower to make. Works in current browsers; very old ones can’t show it.',
  } satisfies Record<WebFormat, string>,
  advanced: 'Advanced',
  useAvif: 'Save as AVIF instead',
  avifHelper: 'Smallest files. Takes longer to make.',

  // Always done
  alwaysTitle: 'Always done for you',
  always: {
    srgb: 'Colours converted to sRGB',
    metadata: 'Location and camera details removed',
    progressive: 'Progressive JPG (shows while loading)',
    noEnlarge: 'Never enlarged or stretched',
  },

  // File list
  filesHeading: (n: number, size: string) => `${n} ${plural(n, 'image', 'images')} · ${size}`,
  filesLabel: 'Images',
  clear: 'Clear',
  removeFile: (name: string) => `Remove ${name}`,
  downloadFile: (name: string) => `Download ${name}`,
  retryFile: (name: string) => `Try ${name} again`,
  waiting: 'Waiting',
  cancelled: 'Stopped',
  failed: 'Couldn’t optimize',
  progressLabel: (name: string) => `Optimizing ${name}`,

  // Checklist under each result
  checklistLabel: 'What was done',
  resizedTo: (px: number) => `Resized to ${px} px`,
  keptAt: (px: number) => `Kept at ${px} px (not enlarged)`,
  locationRemoved: 'Location removed',
  smaller: (percent: number) => `${percent}% smaller`,
  slightlySmaller: 'Slightly smaller',
  looksSame: 'Looks the same',

  // Notes on a result
  keptOriginal: 'Your original was already well compressed — kept it (location data removed)',
  guardShort: 'Very grainy photo — kept the best quality possible',
  larger: (format: string) =>
    `Larger than the original — it was already small and well compressed, and ${format} at this size takes more space`,
  tryJpg: 'Use JPG',
  graphic: 'Looks like a graphic. PNG keeps text sharpest —',
  graphicLink: 'make a PNG with Convert image',
  formatFallback: (format: string) =>
    `Saved as ${format} — this browser can’t make the chosen format`,

  // Small image warning (IMG-06, retina-ready sizes)
  smallWide: (px: number, use: string) => `This image is ${px} px wide — it may look soft ${use}`,
  smallTall: (px: number, use: string) => `This image is ${px} px tall — it may look soft ${use}`,
  smallUse: {
    web: 'as a full-width image',
    wordpress: 'as a full-width image',
    shopify: 'when shoppers zoom in',
    blog: 'as a full-width banner',
    email: 'across a full email',
    thumbnail: 'as a thumbnail',
  } satisfies Record<PresetId, string>,

  // Summary and actions
  working: (done: number, total: number) => `Optimizing ${done} of ${total}…`,
  workingShort: (done: number, total: number) => `${done}/${total}…`,
  runProgress: 'Progress of all images',
  summaryDone: (n: number) => `${n} done`,
  summaryFailed: (n: number) => `${n} failed`,
  summarySaved: (percent: number) => `${percent}% smaller`,
  summaryLarger: 'larger overall',
  zipName: 'optimized-for-web',
} as const;
