/**
 * Tool registry (P10): every tool page and format page, in display order.
 * Read by the routes, the prerender list, the home page and each tool page's <head>.
 * P22 fills in the SEO title and description; ids, groups and routes stay as they are.
 *
 * The home page imports this file at startup, so it holds only what every page's <head> needs.
 * The how-to steps and FAQ (`howTo`/`faq` in the contract) live in each page's lazily loaded
 * `src/tools/<id>/content.tsx` instead (helpers in `_shared/seo-content.ts`).
 *
 * SEO copy rules (P22): plain words for people, no keyword stuffing, spelling that reads the same in
 * British and American English, and never a promise the tool doesn't keep (docs/03-features.md).
 * Titles ≤ 60 characters, descriptions ≤ 155 (checked by registry.seo.test.ts). Phase 2 tools get an
 * honest "coming soon" title and description.
 *
 * Imported by react-router.config.ts at build time, so keep this file free of React and browser code.
 */
import type { FileKind } from '../core/contracts/intake';
import type { ImageFormat } from '../core/contracts/image';
import type { ToolGroup, ToolMeta } from '../core/contracts/tools';

/** Image kinds most image tools take (HEIC is decoded by the image engine). */
const IMAGES: FileKind[] = ['image', 'heic'];
const PDFS: FileKind[] = ['pdf'];

// ---------- Tools ----------

/** The 14 tools from docs/05-architecture.md (URLs). Phase 2 tools show a "Coming soon" page. */
export const tools: readonly ToolMeta[] = [
  {
    id: 'compress-image',
    group: 'Images',
    name: 'Compress image',
    short: 'Smaller files, same look. Set quality or a target size.',
    icon: 'shrink',
    phase: 1,
    accepts: IMAGES,
    title: 'Compress Images and Keep Them Sharp — Free | Snap Convert',
    description:
      'Make JPG, PNG, WebP and AVIF images smaller without making them look worse. Set a quality or a target size in KB. Free, no sign-up, nothing uploaded.',
  },
  {
    id: 'resize-image',
    group: 'Images',
    name: 'Resize image',
    short: 'Change width or height. Proportions always kept.',
    icon: 'scaling',
    phase: 1,
    accepts: IMAGES,
    title: 'Resize Images Without Stretching — Free | Snap Convert',
    description:
      'Resize images by width, height, longest side or percentage. Proportions are always kept, and exact sizes use fit or fill. Free and private.',
  },
  {
    id: 'convert-image',
    group: 'Images',
    name: 'Convert image',
    short: 'JPG, PNG, WebP, AVIF and HEIC.',
    icon: 'arrow-left-right',
    phase: 1,
    accepts: IMAGES,
    title: 'Convert Images to JPG, PNG, WebP, AVIF — Free | Snap Convert',
    description:
      'Convert JPG, PNG, WebP, AVIF, HEIC, GIF and BMP images to JPG, PNG, WebP or AVIF in your browser. Free, no sign-up, and your images are never uploaded.',
  },
  {
    id: 'optimize-for-web',
    group: 'Images',
    name: 'Optimize for web',
    short: 'One click for fast-loading website images.',
    icon: 'gauge',
    phase: 1,
    accepts: IMAGES,
    title: 'Optimize Images for Your Website — Free | Snap Convert',
    description:
      'Small, sharp images for WordPress, Shopify, blogs and email in one click: resized, compressed and stripped of location data. Free and private.',
  },
  {
    id: 'bulk-resize',
    group: 'Images',
    name: 'Bulk resize & compress',
    short: 'Hundreds of images at once, downloaded as a ZIP.',
    icon: 'layers',
    phase: 1,
    accepts: IMAGES,
    title: 'Bulk Resize and Compress Images — Free | Snap Convert',
    description:
      'Resize and compress hundreds of images at once with one set of settings, then download them as a ZIP. No limits, no upload, never stretched.',
  },
  {
    id: 'heic-to-jpg',
    group: 'Images',
    name: 'HEIC to JPG',
    short: 'Open iPhone photos anywhere.',
    icon: 'smartphone',
    phase: 1,
    accepts: ['heic'],
    title: 'HEIC to JPG Converter — Free and Private | Snap Convert',
    description:
      'Turn iPhone and iPad HEIC photos into JPGs that open anywhere. Photos stay upright and full size, and are never uploaded. Free, no sign-up.',
  },
  {
    id: 'images-to-pdf',
    group: 'PDF',
    name: 'Images to PDF',
    short: 'Turn photos or scans into one PDF.',
    icon: 'file-image',
    phase: 1,
    accepts: IMAGES,
    title: 'Images to PDF — Turn Photos into One PDF | Snap Convert',
    description:
      'Combine JPG, PNG, HEIC and other images into one PDF, in the order you choose. A4, Letter or fit to image, never stretched. Free and private.',
  },
  {
    id: 'merge-pdf',
    group: 'PDF',
    name: 'Merge PDF',
    short: 'Combine several PDFs into one, in any order.',
    icon: 'combine',
    phase: 1,
    accepts: PDFS,
    title: 'Merge PDF Files — Free, No Upload | Snap Convert',
    description:
      'Combine several PDF files into one, in any order, right in your browser. Pages keep their size and quality. Free, no sign-up, never uploaded.',
  },
  {
    id: 'split-pdf',
    group: 'PDF',
    name: 'Split PDF',
    short: 'Split by page, range or every N pages.',
    icon: 'split',
    phase: 1,
    accepts: PDFS,
    title: 'Split PDF by Pages or Ranges — Free | Snap Convert',
    description:
      'Split a PDF into single pages, every N pages, or custom ranges like 1-3, 5, 8-10. Download the parts as a ZIP. Free, and nothing is uploaded.',
  },
  {
    id: 'organize-pdf',
    group: 'PDF',
    name: 'Organize pages',
    short: 'Reorder, rotate or delete pages.',
    icon: 'layout-grid',
    phase: 1,
    accepts: PDFS,
    title: 'Reorder, Rotate and Delete PDF Pages — Free | Snap Convert',
    description:
      'See every page of a PDF, then drag to reorder, rotate or delete pages, with undo. Save the new PDF in seconds. Free, and nothing is uploaded.',
  },
  {
    id: 'resize-pdf',
    group: 'PDF',
    name: 'Resize PDF',
    short: 'Change page size, e.g. A4 to Letter.',
    icon: 'scan',
    phase: 1,
    accepts: PDFS,
    title: 'Resize PDF Pages to A4 or Letter — Free | Snap Convert',
    description:
      'Change the page size of a PDF to A4, Letter, A5, Legal or a custom size. Content is scaled to fit, never stretched, and text stays selectable.',
  },
  {
    id: 'remove-background',
    group: 'Power tools',
    name: 'Remove background',
    short: 'Clean cut-outs at full resolution.',
    icon: 'eraser',
    phase: 2,
    accepts: IMAGES,
    title: 'Remove Background from Images — Coming Soon | Snap Convert',
    description:
      'Coming soon: remove the background from photos at full resolution, right in your browser. Until then, Snap Convert’s image and PDF tools are ready.',
  },
  {
    id: 'raw-to-jpg',
    group: 'Power tools',
    name: 'RAW to JPG',
    short: 'Camera RAW photos (CR3, NEF, ARW, DNG…) to JPG.',
    icon: 'camera',
    phase: 2,
    accepts: ['raw'],
    title: 'RAW to JPG Converter — Coming Soon | Snap Convert',
    description:
      'Coming soon: turn camera RAW photos (CR2, CR3, NEF, ARW, DNG and more) into JPGs in your browser. Until then, the image and PDF tools are ready.',
  },
  {
    id: 'pdf-to-images',
    group: 'Power tools',
    name: 'PDF to images',
    short: 'Every page as a JPG or PNG.',
    icon: 'images',
    phase: 2,
    accepts: PDFS,
    title: 'PDF to JPG or PNG — Save Pages as Images | Snap Convert',
    description:
      'Save every page of a PDF, or just the pages you pick, as sharp JPG or PNG images at 72, 150 or 300 dpi. Free, private, nothing is uploaded.',
  },
];

// ---------- Format pages ----------

/** A landing page for one conversion (e.g. PNG to JPG) that opens Convert image with the target pre-set. */
export interface FormatPageMeta extends ToolMeta {
  /** The tool this page reuses. */
  tool: 'convert-image';
  from: ImageFormat;
  to: ImageFormat;
}

const formatLabel: Record<ImageFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
};

const formatSlug: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

function formatPage(from: ImageFormat, to: ImageFormat, description: string): FormatPageMeta {
  const a = formatLabel[from];
  const b = formatLabel[to];
  return {
    id: `${formatSlug[from]}-to-${formatSlug[to]}`,
    group: 'Images',
    name: `${a} to ${b}`,
    short: `Convert ${a} images to ${b}, right in your browser.`,
    icon: 'arrow-left-right',
    phase: 1,
    accepts: ['image'],
    tool: 'convert-image',
    from,
    to,
    title: `${a} to ${b} Converter — Free, No Upload | Snap Convert`,
    description,
  };
}

/** Format pages (served by Convert image with preset settings). */
export const formatPages: readonly FormatPageMeta[] = [
  formatPage(
    'png',
    'jpeg',
    'Convert PNG images to smaller JPGs in your browser. Pick a background for transparent areas. Free, no sign-up, and your images are never uploaded.',
  ),
  formatPage(
    'jpeg',
    'png',
    'Convert JPG photos to lossless PNG files in your browser, ready for editing and apps that need PNG. Free, no sign-up, and nothing is uploaded.',
  ),
  formatPage(
    'webp',
    'jpeg',
    'Convert WebP images to JPGs that open in every app and on every device. Runs in your browser: free, no sign-up, and your images are never uploaded.',
  ),
  formatPage(
    'jpeg',
    'webp',
    'Convert JPG photos to WebP for smaller files and faster web pages. Works in all modern browsers. Free, no sign-up, and nothing is uploaded.',
  ),
  formatPage(
    'png',
    'webp',
    'Convert PNG images to WebP: much smaller files that keep transparency, for faster websites. Free, in your browser, and nothing is uploaded.',
  ),
  formatPage(
    'avif',
    'jpeg',
    'Convert AVIF images to JPGs that open in any app or device. Runs in your browser, so it’s free, needs no sign-up and nothing is uploaded.',
  ),
];

/** Tool groups in the order the home page lists them. */
export const toolGroups: readonly ToolGroup[] = ['Images', 'PDF', 'Power tools'];

export type PageMeta = ToolMeta | FormatPageMeta;

const pagesById = new Map<string, PageMeta>([...tools, ...formatPages].map((p) => [p.id, p]));

/** A tool or format page by its URL slug. */
export function getPage(id: string | undefined): PageMeta | undefined {
  return id === undefined ? undefined : pagesById.get(id);
}

/** A tool (not a format page) by its id. */
export function getTool(id: string | undefined): ToolMeta | undefined {
  return tools.find((t) => t.id === id);
}

export function isFormatPage(page: PageMeta): page is FormatPageMeta {
  return 'tool' in page && 'from' in page && 'to' in page;
}

/**
 * Phase 2+ tools that are live (D39). A tool ships by adding its id here, once its page,
 * engine and tests are merged; until then it shows the "Coming soon" page and stays out of search.
 */
export const RELEASED_LATER: ReadonlySet<string> = new Set<string>(['pdf-to-images']);

/** Tools available now: every phase 1 tool, plus later tools once released. */
export function isAvailable(page: PageMeta): boolean {
  return page.phase === 1 || RELEASED_LATER.has(page.id);
}

export function toolsInGroup(group: ToolGroup): ToolMeta[] {
  return tools.filter((t) => t.group === group);
}

/** Public address of the app; canonical URLs are built from it. */
export const SITE_URL = 'https://crkayes.com/snap-convert/';

/** Canonical URL for a page id, or the home page when no id is given. */
export function canonicalUrl(id?: string): string {
  return id ? `${SITE_URL}${id}` : SITE_URL;
}

// ---------- Social previews and structured data (P22) ----------

/** Size of every Open Graph image in public/og/. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * Absolute URL of the social preview image for a page: one per group (Images, PDF) and one for the
 * home page, which the "Coming soon" tools also use. Omit the page for the home page.
 */
export function ogImageUrl(page?: PageMeta): string {
  const name = page && isAvailable(page) ? (page.group === 'PDF' ? 'pdf' : 'images') : 'home';
  return `${SITE_URL}og/${name}.png`;
}

/**
 * schema.org `SoftwareApplication` for the home page (JSON-LD). Only facts: free, runs on the web.
 * No ratings or reviews (Snap Convert has none to show), so Google treats it as plain structured
 * data rather than a rating rich result. `HowTo` and `FAQPage` are not used: Google dropped both
 * rich results (HowTo in 2023, FAQ in 2026), so the FAQ is plain HTML.
 */
export const homeStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Snap Convert',
  url: SITE_URL,
  description:
    'Free, open-source image and PDF converter that runs in your browser. Compress, resize and convert images, and merge, split and organize PDFs, without uploading anything.',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  image: ogImageUrl(),
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
} as const;
