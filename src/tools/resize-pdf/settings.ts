// Resize PDF settings (remembered per APP-05) and the maths for the page preview. Every size
// comes from `exactPlacement` (src/core/sizing) or the PDF engine's page-size helpers.
import type { NamedPageSize, PageOrientation } from '@/core/contracts/pdf';
import { exactPlacement, type Rect, type Size } from '@/core/sizing';
import {
  MAX_PAGE_POINTS,
  NAMED_PAGE_SIZES,
  mmToPoints,
  orientPage,
  pageSizePoints,
} from '@/engines/pdf';
import { numberIn, oneOf, type SettingsSchema } from '@/features/settings';

export type SizeChoice = NamedPageSize | 'custom';
export type Unit = 'mm' | 'in';

export interface ResizeSettings {
  size: SizeChoice;
  orientation: PageOrientation;
  /** Unit of the custom size fields. */
  unit: Unit;
  customWidth: number;
  customHeight: number;
}

export const SIZE_CHOICES = ['a4', 'letter', 'a5', 'legal', 'custom'] as const;
export const ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const;

export const RESIZE_DEFAULTS: ResizeSettings = {
  size: 'a4',
  orientation: 'auto',
  unit: 'mm',
  customWidth: 210,
  customHeight: 297,
};

/** Custom page sides allowed in each unit (up to 200 inches, the PDF limit). */
export const UNIT_LIMITS: Record<Unit, { min: number; max: number; step: number }> = {
  mm: { min: 1, max: 5080, step: 1 },
  in: { min: 0.1, max: 200, step: 0.1 },
};

export const resizeSettingsSchema: SettingsSchema<ResizeSettings> = {
  size: oneOf(SIZE_CHOICES),
  orientation: oneOf(ORIENTATIONS),
  unit: oneOf(['mm', 'in']),
  customWidth: numberIn(UNIT_LIMITS.in.min, UNIT_LIMITS.mm.max),
  customHeight: numberIn(UNIT_LIMITS.in.min, UNIT_LIMITS.mm.max),
};

const MM_PER_INCH = 25.4;

/** A custom side in points, kept within what PDF readers accept. */
export function toPoints(value: number, unit: Unit): number {
  const points = unit === 'mm' ? mmToPoints(value) : value * 72;
  return Math.min(MAX_PAGE_POINTS, Math.max(1, points));
}

/** Converts a custom side to the other unit (0.1 mm / 0.01 in), within that unit's limits. */
export function convertSide(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  const { min, max } = UNIT_LIMITS[to];
  const raw = to === 'in' ? value / MM_PER_INCH : value * MM_PER_INCH;
  const rounded = to === 'in' ? Math.round(raw * 100) / 100 : Math.round(raw * 10) / 10;
  return Math.min(max, Math.max(min, rounded));
}

/** The page size for `resizePages`: a named size, or the custom size in points. */
export function pageSizeInput(s: ResizeSettings): NamedPageSize | Size {
  if (s.size !== 'custom') return s.size;
  return { width: toPoints(s.customWidth, s.unit), height: toPoints(s.customHeight, s.unit) };
}

/** Same settings → same key: results made with other settings are out of date. */
export function settingsKey(s: ResizeSettings): string {
  return JSON.stringify({ size: pageSizeInput(s), orientation: s.orientation });
}

/** Points to whole hundredths, the unit `exactPlacement` measures pages in here. */
const units = (size: Size): Size => ({
  width: Math.max(1, Math.round(size.width * 100)),
  height: Math.max(1, Math.round(size.height * 100)),
});

/** The new size of a page whose content (as displayed) is `content` points. */
export function newPageSize(content: Size, s: ResizeSettings): Size {
  return orientPage(pageSizePoints(pageSizeInput(s)), s.orientation, content);
}

/** How much the content is scaled on the new page (1 = same size), as the engine places it. */
export function contentScale(content: Size, page: Size): number {
  const src = units(content);
  const { target } = exactPlacement(src, {
    ...units(page),
    fit: 'fit',
    upscale: true,
  });
  return Math.min(target.width / src.width, target.height / src.height);
}

export interface PreviewLayout {
  /** New page size in points. */
  pageSize: Size;
  /** The new page inside the preview box (px). */
  page: Rect;
  /** The old page's content on the new page, relative to the page (px): fitted and centred. */
  content: Rect;
  scale: number;
}

/** Lays out the preview: the new page fitted in `box`, the content fitted and centred on it. */
export function previewLayout(content: Size, s: ResizeSettings, box: Size): PreviewLayout {
  const pageSize = newPageSize(content, s);
  const page = exactPlacement(units(pageSize), { ...box, fit: 'fit', upscale: true }).target;
  const inner = exactPlacement(units(content), {
    width: page.width,
    height: page.height,
    fit: 'fit',
    upscale: true,
  }).target;
  return { pageSize, page, content: inner, scale: contentScale(content, pageSize) };
}

/** The named size a page matches (either way round, within 1 pt), if any. */
export function matchNamedSize(page: Size): NamedPageSize | null {
  for (const [name, size] of Object.entries(NAMED_PAGE_SIZES) as [NamedPageSize, Size][]) {
    const same = (a: Size, b: Size) =>
      Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
    if (same(page, size) || same(page, { width: size.height, height: size.width })) return name;
  }
  return null;
}

/** Points shown in a unit: whole mm, or inches to 0.1. */
export function formatSide(points: number, unit: Unit): string {
  const inches = points / 72;
  return unit === 'mm'
    ? String(Math.round(inches * MM_PER_INCH))
    : String(Math.round(inches * 10) / 10);
}
