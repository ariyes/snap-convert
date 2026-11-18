// What the page knows about each RAW file before running it: camera, upright size, megapixels,
// whether fast mode can use the camera's own JPEG, and what this device's memory allows. Pure
// functions; the reading itself is in details-loader.ts (loaded on demand).

import type { RawOptions } from '@/core/contracts/image';
import { fitSize, type Size } from '@/core/sizing';
import { fullSizePreview, planRaw } from '@/engines/raw/plan';
import type { RawFailure, RawFileInfo } from '@/engines/raw/protocol';
import { rawStrings } from '@/engines/raw/strings';

/** The smallest embedded JPEG we use for a list thumbnail (long side, px). */
export const THUMB_SOURCE_MIN = 160;
/** Thumbnail long side in px (the list shows 44 px; 2× for sharp screens, a little to spare). */
export const THUMB_SIDE = 120;

export interface RawDetails {
  status: 'ready';
  camera?: string;
  /** Upright size of the developed image (orientation applied). */
  width: number;
  height: number;
  /** Sensor size before orientation, for the memory plan. */
  sensor: Size;
  /** Embedded images, for the memory plan. */
  embedded: RawFileInfo['embedded'];
  /** Fast mode uses the camera's full-size JPEG (otherwise it develops the RAW data). */
  cameraJpeg: boolean;
  /** Object URL of a small upright thumbnail from an embedded JPEG. */
  thumbUrl?: string;
}

export interface RawDetailsError {
  status: 'error';
  /** Plain words, shown on the file's row. */
  message: string;
}

export type RawFileDetails = RawDetails | RawDetailsError;

const swaps = (orientation: number) => orientation >= 5 && orientation <= 8;

/** The page's view of the RAW worker's file info. */
export function toDetails(info: RawFileInfo, thumbUrl?: string): RawDetails {
  const upright = swaps(info.orientation)
    ? { width: info.height, height: info.width }
    : { width: info.width, height: info.height };
  const details: RawDetails = {
    status: 'ready',
    ...upright,
    sensor: { width: info.width, height: info.height },
    embedded: info.embedded,
    cameraJpeg: fullSizePreview(info, info.embedded) !== undefined,
  };
  if (info.camera) details.camera = info.camera;
  if (thumbUrl) details.thumbUrl = thumbUrl;
  return details;
}

/** The same plain messages the image engine shows for a RAW file it can't read. */
export function detailsError(failure: RawFailure | undefined): RawDetailsError {
  switch (failure?.kind) {
    case 'unsupported':
      return {
        status: 'error',
        message: failure.format
          ? rawStrings.unsupportedFormat(failure.format)
          : rawStrings.unsupported,
      };
    case 'out-of-memory':
      return { status: 'error', message: rawStrings.tooLarge };
    case 'unavailable':
      return { status: 'error', message: rawStrings.unavailable };
    default:
      return { status: 'error', message: rawStrings.damaged };
  }
}

/** Megapixels, one decimal under 10 ("6.1 MP"), whole above ("24 MP"). */
export function formatMegapixels(size: Size): string {
  const mp = (size.width * size.height) / 1_000_000;
  return `${mp < 10 ? mp.toFixed(1) : Math.round(mp)} MP`;
}

/** Long side ÷ short side. */
const ratio = (s: Size) => Math.max(s.width, s.height) / Math.min(s.width, s.height);

/**
 * The embedded JPEG to make a thumbnail from: the smallest one at least {@link THUMB_SOURCE_MIN} px
 * on its long side with the photo's own shape (Canon's 160 × 120 thumbnail of a 3:2 photo has black
 * bars), else the smallest big enough, else the largest. Undefined when there is no JPEG at all.
 */
export function thumbSource(
  embedded: RawFileInfo['embedded'],
  image?: Size,
): RawFileInfo['embedded'][number] | undefined {
  const jpegs = embedded
    .filter((p) => p.encoding === 'jpeg' && p.width > 0 && p.height > 0)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  const bigEnough = jpegs.filter((p) => Math.max(p.width, p.height) >= THUMB_SOURCE_MIN);
  const sameShape =
    image && image.width > 0 && image.height > 0
      ? bigEnough.find((p) => Math.abs(ratio(p) / ratio(image) - 1) < 0.03)
      : undefined;
  return sameShape ?? bigEnough[0] ?? jpegs[jpegs.length - 1];
}

/** Thumbnail size for an upright image (sizing rule, never enlarged). */
export function thumbSize(upright: Size): Size {
  const { width, height } = fitSize(upright, {
    mode: 'longest',
    value: THUMB_SIDE,
    upscale: false,
  });
  return { width, height };
}

/** What running these files will do on this device: develops, and half-size develops for memory. */
export interface RunOutlook {
  /** Files that will be developed from the RAW data (slower than the camera's JPEG). */
  develops: number;
  /** Of those, files developed at half size because a full develop won't fit this device's memory. */
  halfSize: number;
  /** Total megapixels of the develops. */
  developMegapixels: number;
}

export function runOutlook(
  files: ReadonlyArray<{ details: RawDetails; bytes: number }>,
  mode: RawOptions['mode'],
  budget: number,
  /** The output's longest side when resizing (lets small outputs use half-size develops). */
  minLongestSide?: (details: RawDetails) => number | undefined,
): RunOutlook {
  const out: RunOutlook = { develops: 0, halfSize: 0, developMegapixels: 0 };
  for (const { details, bytes } of files) {
    const plan = planRaw({
      mode,
      image: details.sensor,
      previews: details.embedded,
      fileBytes: bytes,
      budget,
      minLongestSide: minLongestSide?.(details),
    });
    if (plan.use !== 'develop') continue;
    out.develops += 1;
    out.developMegapixels += (details.sensor.width * details.sensor.height) / 1_000_000;
    if (plan.reason === 'memory') out.halfSize += 1;
  }
  return out;
}

/** Above this many megapixels of develops, a phone run counts as big (about four 24 MP files). */
export const PHONE_HEAVY_MEGAPIXELS = 100;

export type PhoneAdvice = 'half-size' | 'slow' | null;

/**
 * What to tell a phone user before a run: some files will come out at half size to fit the
 * phone's memory, or the run is big enough to be slow. Nothing on computers.
 */
export function phoneAdvice(outlook: RunOutlook, phone: boolean): PhoneAdvice {
  if (!phone) return null;
  if (outlook.halfSize > 0) return 'half-size';
  if (outlook.developMegapixels > PHONE_HEAVY_MEGAPIXELS) return 'slow';
  return null;
}
