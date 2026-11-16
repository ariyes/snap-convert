import type { ApplyMetadata, ImageMetadata, MetadataPolicy } from '@/core/contracts/image';
import { exifToTiff, ExifFormatError, prepareExif } from './exif';
import { iccSegments, isSrgbProfile } from './icc';
import {
  type JpegSegment,
  MARKER,
  MAX_SEGMENT_PAYLOAD,
  parseJpeg,
  SIGNATURE,
  startsWith,
  writeJpeg,
} from './jpeg-segments';
import { sniffFormat } from './sniff';

export interface MetadataResult {
  blob: Blob;
  /**
   * The policy asked to keep details but the output isn't a JPEG, so nothing was kept
   * (phase 1). The pipeline adds the `metadata-jpeg-only` note: "Details can only be kept in JPG files".
   */
  jpegOnly: boolean;
  /** An EXIF block was written into the output. */
  exifKept: boolean;
  /** The original EXIF was unreadable or too large to keep, so it was left out. */
  exifDropped: boolean;
  /** An sRGB ICC profile was written into the output. */
  iccKept: boolean;
}

/**
 * Sets what details an encoded image carries (IMG-07):
 * - `strip-all`: no EXIF, XMP, ICC or comments (JPEG header segments are cleaned out; our PNG,
 *   WebP and AVIF encoders write none to begin with).
 * - `keep-all` (JPEG): the original EXIF with orientation set to 1 (pixels are already upright)
 *   and the stale embedded thumbnail removed.
 * - `strip-location` (JPEG): as keep-all, minus the GPS directory (zeroed, not just unlinked).
 * An ICC profile is kept only when it is sRGB, since decoding converted the pixels to sRGB.
 * For PNG, WebP and AVIF, keep-all / strip-location keep nothing and set `jpegOnly`.
 */
export async function applyMetadataDetailed(
  encoded: Blob,
  meta: ImageMetadata,
  policy: MetadataPolicy,
): Promise<MetadataResult> {
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const result: MetadataResult = {
    blob: encoded,
    jpegOnly: false,
    exifKept: false,
    exifDropped: false,
    iccKept: false,
  };
  if (sniffFormat(bytes) !== 'jpeg') {
    result.jpegOnly = policy !== 'strip-all';
    return result;
  }

  const { segments, scan } = parseJpeg(bytes);
  // Keep only what decoding needs: JFIF (APP0), Adobe colour transform (APP14), tables, frame.
  const kept = segments.filter((s) => !isMetadataSegment(s));
  const added: JpegSegment[] = [];

  if (policy !== 'strip-all') {
    if (meta.exif && meta.exif.byteLength > 0) {
      const exif = exifSegment(meta.exif, policy === 'strip-location');
      if (exif) {
        added.push(exif);
        result.exifKept = true;
      } else {
        result.exifDropped = true;
      }
    }
    if (meta.iccProfile && isSrgbProfile(meta.iccProfile)) {
      const icc = iccSegments(new Uint8Array(meta.iccProfile));
      added.push(...icc);
      result.iccKept = icc.length > 0;
    }
  }

  // JFIF must stay first; EXIF and ICC follow it, then the codec's tables and frame.
  const jfifEnd = kept.findIndex((s) => s.marker !== MARKER.APP0);
  const at = jfifEnd < 0 ? kept.length : jfifEnd;
  const out = writeJpeg([...kept.slice(0, at), ...added, ...kept.slice(at)], scan);
  result.blob = new Blob([out], { type: 'image/jpeg' });
  return result;
}

export const applyMetadata: ApplyMetadata = async (encoded, meta, policy) =>
  (await applyMetadataDetailed(encoded, meta, policy)).blob;

/** APP1–APP15 (EXIF, XMP, ICC, maker data…) and comments; APP0 unless JFIF; APP14 unless Adobe. */
function isMetadataSegment(s: JpegSegment): boolean {
  if (s.marker === MARKER.COM) return true;
  if (s.marker === MARKER.APP0) return !startsWith(s.data, SIGNATURE.jfif);
  if (s.marker === MARKER.APP14) return !startsWith(s.data, SIGNATURE.adobe);
  return s.marker > MARKER.APP0 && s.marker <= 0xef;
}

/** The APP1 EXIF segment to write, or null if the block is damaged or too big for one segment. */
function exifSegment(exif: ArrayBuffer, removeGps: boolean): JpegSegment | null {
  let tiff: Uint8Array;
  try {
    tiff = prepareExif(exifToTiff(exif), { removeGps });
  } catch (e) {
    if (e instanceof ExifFormatError || e instanceof RangeError) return null;
    throw e;
  }
  const header = SIGNATURE.exif.length;
  if (header + tiff.length > MAX_SEGMENT_PAYLOAD) return null;
  const data = new Uint8Array(header + tiff.length);
  for (let i = 0; i < header; i++) data[i] = SIGNATURE.exif.charCodeAt(i);
  data.set(tiff, header);
  return { marker: MARKER.APP1, data };
}
