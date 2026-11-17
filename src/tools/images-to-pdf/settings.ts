// Settings of the Images to PDF page (remembered with useToolSettings) and how they map to the
// PDF job (ImagesToPdfInput).

import type { NamedPageSize, PageOrientation, PageSize } from '@/core/contracts/pdf';
import { oneOf, type SettingsSchema } from '@/features/settings';

export const TOOL_ID = 'images-to-pdf';

export type PageSizeChoice = NamedPageSize | 'fit-image';
export type MarginChoice = 'none' | 'small' | 'large';
export type QualityChoice = 'original' | 'smaller';

export const PAGE_SIZE_CHOICES: readonly PageSizeChoice[] = [
  'a4',
  'letter',
  'a5',
  'legal',
  'fit-image',
];
export const ORIENTATIONS: readonly PageOrientation[] = ['auto', 'portrait', 'landscape'];
export const MARGIN_CHOICES: readonly MarginChoice[] = ['none', 'small', 'large'];
export const QUALITY_CHOICES: readonly QualityChoice[] = ['original', 'smaller'];

/** Margin around each image, in millimetres. */
export const MARGIN_MM: Readonly<Record<MarginChoice, number>> = { none: 0, small: 10, large: 20 };

/** "Smaller file": every image goes through the image pipeline at this longest side and quality. */
export const SMALLER_FILE = { longestSide: 2480, quality: 85 } as const;
/** HEIC, WebP, AVIF, GIF and BMP can't go into a PDF: they become JPEG at this quality (or PNG). */
export const CONVERT_JPEG_QUALITY = 92;

export interface ImagesToPdfSettings {
  pageSize: PageSizeChoice;
  orientation: PageOrientation;
  margin: MarginChoice;
  quality: QualityChoice;
}

export const settingsSchema: SettingsSchema<ImagesToPdfSettings> = {
  pageSize: oneOf(PAGE_SIZE_CHOICES),
  orientation: oneOf(ORIENTATIONS),
  margin: oneOf(MARGIN_CHOICES),
  quality: oneOf(QUALITY_CHOICES),
};

/** Regions that use US Letter paper (the brief: US and Canada); everyone else gets A4. */
const LETTER_REGIONS = new Set(['US', 'CA']);

/** Region of a language tag ("en-US" → "US", "fr-CA" → "CA", "en" → likely region "US"). */
export function regionOf(tag: string): string | undefined {
  try {
    const locale = new Intl.Locale(tag);
    return locale.region ?? locale.maximize().region;
  } catch {
    return undefined;
  }
}

/** Letter for US and Canada locales, A4 everywhere else (and when the locale can't be read). */
export function localePageSize(languages?: readonly string[]): 'a4' | 'letter' {
  let tags = languages;
  if (!tags) {
    try {
      tags =
        typeof navigator === 'undefined'
          ? []
          : navigator.languages?.length
            ? navigator.languages
            : [navigator.language];
    } catch {
      tags = [];
    }
  }
  const first = tags.find((t) => typeof t === 'string' && t.length > 0);
  const region = first ? regionOf(first) : undefined;
  return region && LETTER_REGIONS.has(region) ? 'letter' : 'a4';
}

export function defaultSettings(languages?: readonly string[]): ImagesToPdfSettings {
  return {
    pageSize: localePageSize(languages),
    orientation: 'auto',
    margin: 'none',
    quality: 'original',
  };
}

/** The page part of the PDF job. */
export function toPdfPageOptions(s: ImagesToPdfSettings): {
  pageSize: PageSize;
  orientation: PageOrientation;
  marginMm: number;
} {
  return { pageSize: s.pageSize, orientation: s.orientation, marginMm: MARGIN_MM[s.margin] };
}
