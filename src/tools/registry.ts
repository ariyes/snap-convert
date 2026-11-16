/**
 * Tool registry (P10): every tool page and format page, in display order.
 * Read by the routes, the prerender list, the home page and each tool page's <head>.
 * P22 fills in the SEO fields (title, description, howTo, faq); ids, groups and routes stay as they are.
 *
 * Imported by react-router.config.ts at build time, so keep this file free of React and browser code.
 */
import type { FileKind } from '../core/contracts/intake';
import type { ImageFormat } from '../core/contracts/image';
import type { ToolGroup, ToolMeta } from '../core/contracts/tools';

/** Image kinds most image tools take (HEIC is decoded by the image engine). */
const IMAGES: FileKind[] = ['image', 'heic'];
const PDFS: FileKind[] = ['pdf'];

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
  },
  {
    id: 'resize-image',
    group: 'Images',
    name: 'Resize image',
    short: 'Change width or height. Proportions always kept.',
    icon: 'scaling',
    phase: 1,
    accepts: IMAGES,
  },
  {
    id: 'convert-image',
    group: 'Images',
    name: 'Convert image',
    short: 'JPG, PNG, WebP, AVIF and HEIC.',
    icon: 'arrow-left-right',
    phase: 1,
    accepts: IMAGES,
  },
  {
    id: 'optimize-for-web',
    group: 'Images',
    name: 'Optimize for web',
    short: 'One click for fast-loading website images.',
    icon: 'gauge',
    phase: 1,
    accepts: IMAGES,
  },
  {
    id: 'bulk-resize',
    group: 'Images',
    name: 'Bulk resize & compress',
    short: 'Hundreds of images at once, downloaded as a ZIP.',
    icon: 'layers',
    phase: 1,
    accepts: IMAGES,
  },
  {
    id: 'heic-to-jpg',
    group: 'Images',
    name: 'HEIC to JPG',
    short: 'Open iPhone photos anywhere.',
    icon: 'smartphone',
    phase: 1,
    accepts: ['heic'],
  },
  {
    id: 'images-to-pdf',
    group: 'PDF',
    name: 'Images to PDF',
    short: 'Turn photos or scans into one PDF.',
    icon: 'file-image',
    phase: 1,
    accepts: IMAGES,
  },
  {
    id: 'merge-pdf',
    group: 'PDF',
    name: 'Merge PDF',
    short: 'Combine several PDFs into one, in any order.',
    icon: 'combine',
    phase: 1,
    accepts: PDFS,
  },
  {
    id: 'split-pdf',
    group: 'PDF',
    name: 'Split PDF',
    short: 'Split by page, range or every N pages.',
    icon: 'split',
    phase: 1,
    accepts: PDFS,
  },
  {
    id: 'organize-pdf',
    group: 'PDF',
    name: 'Organize pages',
    short: 'Reorder, rotate or delete pages.',
    icon: 'layout-grid',
    phase: 1,
    accepts: PDFS,
  },
  {
    id: 'resize-pdf',
    group: 'PDF',
    name: 'Resize PDF',
    short: 'Change page size, e.g. A4 to Letter.',
    icon: 'scan',
    phase: 1,
    accepts: PDFS,
  },
  {
    id: 'remove-background',
    group: 'Power tools',
    name: 'Remove background',
    short: 'Clean cut-outs at full resolution.',
    icon: 'eraser',
    phase: 2,
    accepts: IMAGES,
  },
  {
    id: 'raw-to-jpg',
    group: 'Power tools',
    name: 'RAW to JPG',
    short: 'Camera RAW photos (CR3, NEF, ARW, DNG…) to JPG.',
    icon: 'camera',
    phase: 2,
    accepts: ['raw'],
  },
  {
    id: 'pdf-to-images',
    group: 'Power tools',
    name: 'PDF to images',
    short: 'Every page as a JPG or PNG.',
    icon: 'images',
    phase: 2,
    accepts: PDFS,
  },
];

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

function formatPage(from: ImageFormat, to: ImageFormat): FormatPageMeta {
  return {
    id: `${formatSlug[from]}-to-${formatSlug[to]}`,
    group: 'Images',
    name: `${formatLabel[from]} to ${formatLabel[to]}`,
    short: `Convert ${formatLabel[from]} images to ${formatLabel[to]}, right in your browser.`,
    icon: 'arrow-left-right',
    phase: 1,
    accepts: ['image'],
    tool: 'convert-image',
    from,
    to,
  };
}

/** Format pages (served by Convert image with preset settings). */
export const formatPages: readonly FormatPageMeta[] = [
  formatPage('png', 'jpeg'),
  formatPage('jpeg', 'png'),
  formatPage('webp', 'jpeg'),
  formatPage('jpeg', 'webp'),
  formatPage('png', 'webp'),
  formatPage('avif', 'jpeg'),
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

/** Tools available now (phase 1). */
export function isAvailable(page: PageMeta): boolean {
  return page.phase === 1;
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
