// Where an image sits on its PDF page, for the live preview. Mirrors P07's images-to-pdf op
// (page size, orientation, margins, fit) but every placement comes from `exactPlacement`, so the
// preview can never show a stretched image either.

import type { PageOrientation } from '@/core/contracts/pdf';
import { exactPlacement, type Rect, type Size } from '@/core/sizing';
import { MAX_PAGE_POINTS, mmToPoints, NAMED_PAGE_SIZES, orientPage } from '@/engines/pdf';
import type { PageSizeChoice } from './settings';

export interface PageOptions {
  pageSize: PageSizeChoice;
  orientation: PageOrientation;
  marginMm: number;
}

/** The page in points: portrait or landscape for fixed sizes, the image size for "fit to image". */
export function pageSizeFor(image: Size, o: PageOptions): Size {
  const margin = mmToPoints(o.marginMm);
  if (o.pageSize === 'fit-image') {
    // 1 px = 1 pt plus the margins, shrunk (never stretched) to stay within 200 inches.
    const limit = Math.max(1, Math.round(MAX_PAGE_POINTS - 2 * margin));
    const fitted = exactPlacement(image, {
      width: limit,
      height: limit,
      fit: 'fit',
      upscale: false,
    }).target;
    return { width: fitted.width + 2 * margin, height: fitted.height + 2 * margin };
  }
  return orientPage(NAMED_PAGE_SIZES[o.pageSize], o.orientation, image);
}

/** Size of the preview drawing box in units. The page is fitted inside it. */
export const PREVIEW_BOX: Readonly<Size> = { width: 1000, height: 1300 };

export interface PreviewLayout {
  /** The page in points. */
  page: Size;
  landscape: boolean;
  /** Page, margin area and image inside the preview box, in percent of the box (top-left origin). */
  pageRect: Rect;
  contentRect: Rect;
  imageRect: Rect;
}

const percent = (r: Rect, box: Size): Rect => ({
  x: (r.x / box.width) * 100,
  y: (r.y / box.height) * 100,
  width: (r.width / box.width) * 100,
  height: (r.height / box.height) * 100,
});

/**
 * The preview drawing: the page fitted into {@link PREVIEW_BOX}, the margins scaled with it and the
 * image fitted (and centred) inside the margins — as the PDF op places it.
 */
export function previewLayout(image: Size, o: PageOptions, box: Size = PREVIEW_BOX): PreviewLayout {
  const source = {
    width: Math.max(1, Math.round(image.width)),
    height: Math.max(1, Math.round(image.height)),
  };
  const page = pageSizeFor(source, o);
  // Hundredths of a point keep A4's 595.28 × 841.89 exact enough for whole-unit placement.
  const pageRect = exactPlacement(
    { width: Math.round(page.width * 100), height: Math.round(page.height * 100) },
    { width: box.width, height: box.height, fit: 'fit', upscale: true },
  ).target;

  const scale = pageRect.width / page.width;
  const margin = Math.round(mmToPoints(o.marginMm) * scale);
  const content: Rect = {
    x: pageRect.x + margin,
    y: pageRect.y + margin,
    width: Math.max(1, pageRect.width - 2 * margin),
    height: Math.max(1, pageRect.height - 2 * margin),
  };
  // Fixed sizes scale the image up or down to fill the space; "fit to image" already matches it.
  const placed = exactPlacement(source, {
    width: content.width,
    height: content.height,
    fit: 'fit',
    upscale: true,
  }).target;
  const imageRect: Rect = {
    x: content.x + placed.x,
    y: content.y + placed.y,
    width: placed.width,
    height: placed.height,
  };

  return {
    page,
    landscape: page.width > page.height,
    pageRect: percent(pageRect, box),
    contentRect: percent(content, box),
    imageRect: percent(imageRect, box),
  };
}
