import type { ImageMetadata } from '@/core/contracts/image';
import type { ContainerInfo } from './container';

type Tags = Record<string, unknown>;

/** Copies a view into its own ArrayBuffer, so the result doesn't keep the whole file alive. */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.slice().buffer;
}

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  // EXIF strings are often padded with NULs or spaces.
  const s = v.replace(/\0+$/, '').trim();
  return s.length > 0 ? s : undefined;
}

/** "Canon" + "Canon EOS R5" → "Canon EOS R5"; "Apple" + "iPhone 7" → "Apple iPhone 7". */
export function cameraName(make: string | undefined, model: string | undefined): string | undefined {
  if (!make) return model;
  if (!model) return make;
  const firstWord = make.split(/\s+/)[0] ?? make;
  return model.toLowerCase().startsWith(firstWord.toLowerCase()) ? model : `${make} ${model}`;
}

/** "2019:03:21 11:04:22" (+ optional "+01:00") → "2019-03-21T11:04:22+01:00". EXIF times have no zone unless an offset tag exists. */
export function exifDateToIso(value: unknown, offset?: unknown): string | undefined {
  const s = text(value);
  const m = s?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, se] = m;
  if (y === '0000' || mo === '00' || d === '00') return undefined;
  const zone = text(offset);
  const validZone = zone && /^[+-]\d{2}:\d{2}$/.test(zone) ? zone : '';
  return `${y}-${mo}-${d}T${h}:${mi}:${se}${validZone}`;
}

/**
 * Builds the contract's metadata from the container's raw blocks. EXIF tags are parsed with
 * exifr (loaded on demand). A broken EXIF block never fails the decode: we fall back to defaults.
 */
export async function readMetadata(info: ContainerInfo): Promise<ImageMetadata> {
  const meta: ImageMetadata = { orientation: 1, hasLocation: false };
  if (info.icc && info.icc.length > 0) meta.iccProfile = toArrayBuffer(info.icc);
  if (!info.exif || info.exif.length < 8) return meta;
  meta.exif = toArrayBuffer(info.exif);

  let tags: Tags | undefined;
  try {
    const { parse } = await import('exifr');
    const out: unknown = await parse(new Uint8Array(meta.exif), {
      tiff: true,
      ifd0: {},
      exif: true,
      gps: true,
      interop: false,
      ifd1: false,
      xmp: false,
      icc: false,
      iptc: false,
      translateKeys: true,
      translateValues: false,
      reviveValues: false,
      mergeOutput: true,
    });
    if (out && typeof out === 'object') tags = out as Tags;
  } catch {
    tags = undefined;
  }
  if (!tags) return meta;

  const orientation = tags.Orientation;
  if (typeof orientation === 'number' && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8) {
    meta.orientation = orientation;
  }
  meta.hasLocation = tags.GPSLatitude !== undefined || tags.GPSLongitude !== undefined;
  const camera = cameraName(text(tags.Make), text(tags.Model));
  if (camera) meta.camera = camera;
  const takenAt =
    exifDateToIso(tags.DateTimeOriginal, tags.OffsetTimeOriginal) ??
    exifDateToIso(tags.CreateDate, tags.OffsetTimeDigitized) ??
    exifDateToIso(tags.ModifyDate, tags.OffsetTime);
  if (takenAt) meta.takenAt = takenAt;
  return meta;
}
