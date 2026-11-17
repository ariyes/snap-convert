/** User-facing text for the app shell, home page and fallback pages (P10). Tool names live in the registry. */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const appStrings = {
  // Head
  homeTitle: 'Snap Convert — Free image and PDF converter in your browser',
  homeDescription:
    'Compress, resize and convert images, and merge or split PDFs, right in your browser. Free, no sign-up, no watermarks. Your files never leave your device.',
  pageTitle: (name: string) => `${name} — Snap Convert`,

  // Header
  skipToContent: 'Skip to content',
  allTools: 'All tools',
  source: 'Source',
  mainNav: 'Main',

  // Footer
  footerNotice:
    'Snap Convert is free and open source (AGPL-3.0). Your files never leave your device.',
  footerNav: 'Site',
  sourceCode: 'Source code',
  credits: 'Open-source credits',
  privacy: 'Privacy',
  crkayes: 'crkayes.com',

  // Home
  eyebrow: 'Free · Private · No sign-up',
  heroTitle: 'Convert, resize and compress files, right in your browser.',
  lede: 'Images and PDFs in one place, with camera RAW coming soon. No limits, no watermarks, and your files never leave your device.',
  dropTitle: 'Drop any files here',
  dropFormats: 'JPG · PNG · WebP · AVIF · HEIC · PDF · RAW',
  trust: [
    {
      title: 'Private',
      text: 'Everything runs on your device. Nothing is uploaded.',
    },
    {
      title: 'Free, no limits',
      text: 'No sign-up, no daily cap, no file-size cap, no watermark.',
    },
    {
      title: 'Never stretched',
      text: 'Proportions are always kept when you resize.',
    },
  ],
  comingSoon: 'Coming soon',

  // Suggestion panel
  fileCount: {
    images: (n: number) => plural(n, 'image', 'images'),
    pdfs: (n: number) => plural(n, 'PDF', 'PDFs'),
    raws: (n: number) => plural(n, 'RAW photo', 'RAW photos'),
    others: (n: number) => plural(n, 'other file', 'other files'),
  },
  /** "a", "a and b", "a, b and c" */
  joinList: (parts: string[]) =>
    parts.length <= 1
      ? (parts[0] ?? '')
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`,
  suggestQuestion: (what: string) => `What do you want to do with ${what}?`,
  suggestClear: 'Clear',
  suggestUnknown: "Snap Convert doesn't handle this file type yet.",
  suggestionsLabel: 'Suggested tools',
  chip: {
    compress: 'Compress',
    resize: 'Resize',
    convert: 'Convert',
    optimize: 'Optimize for web',
    makePdf: 'Make a PDF',
    removeBackground: 'Remove background',
    merge: 'Merge',
    split: 'Split',
    organize: 'Organize pages',
    resizePages: 'Resize pages',
    rawToJpg: 'RAW to JPG',
  },
  /** Marker on a suggestion chip for a tool that isn't available yet. */
  soon: 'Soon',

  // Tool pages
  breadcrumb: 'Breadcrumb',
  privacyLine: 'Processed on your device. Nothing is uploaded.',
  placeholderTitle: 'Coming in this build',
  placeholderText:
    'This tool is being built. It will use the same layout as every tool: files on the left, settings on the right, download at the bottom.',
  receivedFiles: (n: number) => `${plural(n, 'file', 'files')} ready from the home page:`,
  comingSoonTitle: 'Coming soon',
  comingSoonText:
    'This tool arrives in the next phase. It will use the same layout as every other tool.',
  backToTools: 'All tools',

  // Not found and errors
  notFoundTitle: 'Page not found',
  notFoundText: "This page doesn't exist. It may have moved, or the address has a typo.",
  errorTitle: 'Something went wrong',
  errorText:
    'This page hit a problem. Your files never left your device. Reload the page to try again.',
  reload: 'Reload',
  goHome: 'Go to all tools',
} as const;
