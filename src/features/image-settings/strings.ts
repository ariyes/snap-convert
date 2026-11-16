import type { MetadataPolicy, OutputFormat } from '@/core/contracts/image';

/** Format names as users know them. */
const formatNames: Record<OutputFormat, string> = {
  keep: 'Same as original',
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
};

/** User-facing text of the shared image settings controls (P13). Wording from the prototype (D18). */
export const imageSettingsStrings = {
  // Quick presets (IMG-06)
  presetsTitle: 'Quick presets',
  presetsTipLabel: 'About quick presets',
  presetsTip:
    'Sets size, format and quality for common places you upload images. You can still change anything after.',
  presetSummary: (longestSide: number, format: OutputFormat, quality: number) =>
    `Longest side ${longestSide} px, ${formatNames[format]}, quality ${quality}`,
  presetApplied: (name: string, summary: string) => `${name} preset: ${summary}`,

  // Quality or target size
  compressionMode: 'Compression mode',
  byQuality: 'By quality',
  targetFileSize: 'Target file size',
  quality: 'Quality',
  qualityTipLabel: 'About quality',
  qualityTip:
    "Lower quality makes a smaller file. Between 75 and 85 most people can't see a difference.",
  qualityHelper: '80 looks the same as the original for most photos.',
  targetLabel: 'Make each file smaller than',
  targetTipLabel: 'About target file size',
  targetTip:
    'Snap Convert tries different quality levels and picks the best one that fits under this size.',
  targetHelper: 'We find the best quality that fits. Works with JPG, WebP and AVIF.',
  unitKb: 'KB',

  // Format
  saveAs: 'Save as',
  formatNames,
  formatKeepShort: 'Same',
  graphicHint: 'This looks like a graphic. PNG keeps text sharper.',
  usePng: 'Use PNG',

  // Resize
  alsoResize: 'Also resize',
  alsoResizeHelper: 'Smaller dimensions save the most space.',
  alsoResizeTipLabel: 'About resizing',
  alsoResizeTip:
    'Longest side: the bigger of width and height becomes this size, and the other side follows to keep proportions. Images are never enlarged or stretched.',
  resizeBy: 'Resize by',
  resizeByTipLabel: 'About resize modes',
  resizeByTip:
    'Longest side: the bigger of width and height becomes this size. Max width / height: only that side is limited. The other side always follows, so nothing is stretched.',
  resizeModes: {
    longest: 'Longest side',
    width: 'Max width',
    height: 'Max height',
    percent: 'Percentage',
    exact: 'Exact size (fit or fill)',
    none: "Don't resize",
  },
  size: 'Size',
  unitPx: 'px',
  unitPercent: '%',
  width: 'Width',
  height: 'Height',
  unitWidth: 'W',
  unitHeight: 'H',
  times: '×',
  lockedNote: 'Proportions are locked. Images already smaller than this are left as they are.',
  lockedNoteUpscale: 'Proportions are locked. Smaller images are enlarged to this size.',
  fitTitle: 'How to fit the box',
  fitTipLabel: 'About Fit and Fill',
  fitTip:
    "Fit shows the whole image and fills the empty space with a colour. Fill covers the whole box and trims the edges that don't fit. Neither one stretches the image.",
  fitGroup: 'How to fit',
  fit: 'Fit',
  fitDescription: 'Whole image, padded',
  fill: 'Fill',
  fillDescription: 'Fills box, edges cropped',
  padColour: 'Padding colour',
  padColourNames: { white: 'White', black: 'Black', lightGrey: 'Light grey' },
  neverStretched: 'Images are never stretched to fit a size.',
  upscale: 'Enlarge smaller images',
  upscaleNote: 'Enlarged images can look soft. Keep this off unless you need a bigger size.',

  // Dimensions preview
  dimsLabel: 'New size',
  proportionsLocked: 'Proportions locked',
  notEnlarged: 'Already smaller · not enlarged',
  enlarged: 'Enlarged',
  padded: 'padded',
  cropped: 'cropped',
  smallForUse: (minSide: number) => `${minSide} px or more looks sharper for full-width images.`,

  // Metadata
  removeDetails: 'Remove location and camera details',
  metadataTipLabel: 'About location and camera details',
  metadataTip:
    'Photos can contain hidden details like GPS location, date and camera model. Removing them protects your privacy and saves space.',
  metadataHelper: 'Smaller file and more private.',
  moreOptions: 'More options',
  metadataPolicyGroup: 'Photo details',
  metadataPolicies: {
    'strip-all': 'Remove everything',
    'strip-location': 'Remove location only',
    'keep-all': 'Keep everything',
  } satisfies Record<MetadataPolicy, string>,
  jpegOnly: 'Details can only be kept in JPG files.',

  // File names
  fileNames: 'File names',
  fileNamesTipLabel: 'About file names',
  fileNamesTip:
    'Words in curly brackets are filled in for each file: {name} original name, {width} and {height} new size, {n} file number, {format} file type.',
  fileNamesExample: 'e.g.',
  fileNamesTokens: 'use {name} {width} {height} {n} {format}',
} as const;
