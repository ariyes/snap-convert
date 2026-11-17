// Settings of PDF to images (remembered with useToolSettings), the pages to save, output names and
// the image job each rendered page becomes.
import type { ImageJobInput } from '@/core/contracts/image';
import { parseRanges, pdfStrings } from '@/engines/pdf';
import { PAGE_IMAGE_LIMITS } from '@/engines/pdf/render';
import { applyNamePattern } from '@/features/export';
import { numberIn, oneOf, type SettingCheck, type SettingsSchema } from '@/features/settings';
import { baseName, EXTENSIONS } from '@/tools/_shared';

export const TOOL_ID = 'pdf-to-images';

export const PAGE_FORMATS = ['jpeg', 'png'] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];

export const RESOLUTIONS = ['screen', 'standard', 'print', 'custom'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** DPI of the fixed resolution choices. */
export const RESOLUTION_DPI: Readonly<Record<Exclude<Resolution, 'custom'>, number>> = {
  screen: 72,
  standard: 150,
  print: 300,
};

export const QUALITY_MODES = ['auto', 'custom'] as const;
export type QualityMode = (typeof QUALITY_MODES)[number];

export const PAGE_MODES = ['all', 'choose'] as const;
export type PageMode = (typeof PAGE_MODES)[number];

/** JPG quality the quality guard starts from in Auto (it raises it until the page looks the same). */
export const AUTO_QUALITY = 80;

export const QUALITY_LIMITS = { min: 10, max: 100 } as const;

/** `{n}` is the page number, zero-padded to the page count. */
export const DEFAULT_NAME_PATTERN = '{name}-p{n}';
export const MAX_PATTERN_LENGTH = 200;

export interface PdfToImagesSettings {
  format: PageFormat;
  resolution: Resolution;
  /** 36–600, used with resolution 'custom'. */
  customDpi: number;
  /** Auto: the quality guard keeps every page crisp (D28/D29). Custom: the user's quality as set. */
  qualityMode: QualityMode;
  quality: number;
  rename: string;
}

export const DEFAULTS: Readonly<PdfToImagesSettings> = {
  format: 'jpeg',
  resolution: 'standard',
  customDpi: 200,
  qualityMode: 'auto',
  quality: AUTO_QUALITY,
  rename: DEFAULT_NAME_PATTERN,
};

const isPattern: SettingCheck<string> = (value): value is string =>
  typeof value === 'string' && value.length <= MAX_PATTERN_LENGTH;

export const SCHEMA: SettingsSchema<PdfToImagesSettings> = {
  format: oneOf(PAGE_FORMATS),
  resolution: oneOf(RESOLUTIONS),
  customDpi: numberIn(PAGE_IMAGE_LIMITS.minDpi, PAGE_IMAGE_LIMITS.maxDpi),
  qualityMode: oneOf(QUALITY_MODES),
  quality: numberIn(QUALITY_LIMITS.min, QUALITY_LIMITS.max),
  rename: isPattern,
};

/** The DPI pages are drawn at. */
export function dpiOf(settings: Pick<PdfToImagesSettings, 'resolution' | 'customDpi'>): number {
  if (settings.resolution !== 'custom') return RESOLUTION_DPI[settings.resolution];
  const dpi = Math.round(settings.customDpi);
  return Math.min(PAGE_IMAGE_LIMITS.maxDpi, Math.max(PAGE_IMAGE_LIMITS.minDpi, dpi));
}

// ---------- pages ----------

export type PagePlan = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * The 1-based pages to save, in page order: every page, or the ones in `ranges` ("1-3, 5"), with
 * Split's exact messages when the text isn't valid.
 */
export function planPages(mode: PageMode, ranges: string, pageCount: number): PagePlan {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: pdfStrings.noPages() };
  }
  if (mode === 'all')
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i + 1) };
  try {
    const pages = [...new Set(parseRanges(ranges, pageCount).flat())].sort((a, b) => a - b);
    return { ok: true, pages };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, error: error.message };
    throw error;
  }
}

// ---------- names ----------

/** Digits in page numbers: at least 2 ("p01"), more for 100+ pages ("p001"). */
export function pageDigits(pageCount: number): number {
  return Math.max(2, String(Math.max(1, Math.floor(pageCount))).length);
}

export interface PageNameContext {
  /** The PDF's file name. */
  pdfName: string;
  /** 1-based. */
  page: number;
  pageCount: number;
  width: number;
  height: number;
  format: PageFormat;
}

/**
 * Output file name for one page: the pattern (default "{name}-p{n}") with {n} the zero-padded page
 * number, made safe, plus the extension. "report.pdf", page 1 of 3 → "report-p01.jpg".
 */
export function pageFileName(pattern: string, ctx: PageNameContext): string {
  const ext = EXTENSIONS[ctx.format];
  const page = String(ctx.page).padStart(pageDigits(ctx.pageCount), '0');
  const used = pattern.trim() === '' ? DEFAULT_NAME_PATTERN : pattern;
  // {n} is filled in here, zero-padded; applyNamePattern fills in the rest. Only the pattern's own
  // {n} is replaced, never one inside the PDF's name.
  const withPage = used.replace(/\{n\}/gi, page);
  const base = applyNamePattern(withPage, {
    name: baseName(ctx.pdfName),
    width: ctx.width,
    height: ctx.height,
    n: ctx.page,
    format: ext,
  });
  return `${base}.${ext}`;
}

// ---------- the image job ----------

export interface RenderedPage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * The image job that encodes one rendered page: JPG with the quality guard on in Auto (D24/D29) or
 * the user's quality, PNG lossless (oxipng). Never resized again (no `resize` / `exact`), metadata
 * stripped. The size lets the queue run pages over 40 MP alone.
 */
export function pageJobInput(
  rendered: RenderedPage,
  name: string,
  settings: Pick<PdfToImagesSettings, 'format' | 'qualityMode' | 'quality'>,
): ImageJobInput {
  const auto = settings.qualityMode === 'auto';
  return {
    file: rendered.blob,
    name,
    format: settings.format,
    quality: auto ? AUTO_QUALITY : settings.quality,
    metadata: 'strip-all',
    qualityGuard: settings.format === 'jpeg' && auto,
    width: rendered.width,
    height: rendered.height,
  };
}
