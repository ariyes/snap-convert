// Photos go into the PDF as they are ("Original"), so their EXIF would go with them — including
// where they were taken. Before embedding, each JPEG runs through P06's metadata tools with
// `strip-location`: GPS removed (and zeroed), XMP and comments dropped, pixels untouched (no
// re-encode). The EXIF orientation is put back afterwards, because the PDF engine (P07) turns the
// page from it — PDF viewers ignore EXIF. This only edits header bytes, so it's quick enough for
// the main thread.

import {
  applyMetadataDetailed,
  exifToTiff,
  JpegFormatError,
  parseJpeg,
  readExifInfo,
  writeJpeg,
  type JpegSegment,
} from '@/engines/image/metadata';

const APP0 = 0xe0;
const APP1 = 0xe1;
const EXIF_HEADER = 'Exif\0\0';
const ORIENTATION_TAG = 0x0112;

function startsWithText(data: Uint8Array, text: string): boolean {
  if (data.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (data[i] !== text.charCodeAt(i)) return false;
  return true;
}

const isExif = (s: JpegSegment) => s.marker === APP1 && startsWithText(s.data, EXIF_HEADER);

/** EXIF orientation (1–8) from an APP1 payload; 1 when there is none or it can't be read. */
function orientationOf(exif: Uint8Array): number {
  try {
    const o = readExifInfo(exifToTiff(exif)).orientation;
    return o !== undefined && Number.isInteger(o) && o >= 1 && o <= 8 ? o : 1;
  } catch {
    return 1;
  }
}

/**
 * Sets the orientation entry of IFD0 in an APP1 EXIF payload, in place. False when the block has
 * no orientation entry or can't be read.
 */
function setOrientation(exif: Uint8Array, orientation: number): boolean {
  const tiffAt = EXIF_HEADER.length;
  const view = new DataView(exif.buffer, exif.byteOffset + tiffAt, exif.byteLength - tiffAt);
  try {
    const order = view.getUint16(0);
    if (order !== 0x4949 && order !== 0x4d4d) return false;
    const little = order === 0x4949;
    const ifd = view.getUint32(4, little);
    const count = view.getUint16(ifd, little);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (view.getUint16(entry, little) !== ORIENTATION_TAG) continue;
      view.setUint16(entry + 2, 3, little); // SHORT
      view.setUint32(entry + 4, 1, little); // one value
      view.setUint32(entry + 8, 0, little);
      view.setUint16(entry + 8, orientation, little);
      return true;
    }
  } catch (e) {
    if (e instanceof RangeError) return false;
    throw e;
  }
  return false;
}

/** The smallest EXIF payload that says only how the image is turned. */
function orientationOnlyExif(orientation: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(EXIF_HEADER.length + 26);
  for (let i = 0; i < EXIF_HEADER.length; i++) out[i] = EXIF_HEADER.charCodeAt(i);
  const v = new DataView(out.buffer, EXIF_HEADER.length);
  v.setUint16(0, 0x4d4d); // big-endian
  v.setUint16(2, 42);
  v.setUint32(4, 8); // IFD0 right after the header
  v.setUint16(8, 1); // one entry
  v.setUint16(10, ORIENTATION_TAG);
  v.setUint16(12, 3); // SHORT
  v.setUint32(14, 1);
  v.setUint16(18, orientation);
  v.setUint32(22, 0); // no next IFD
  return out;
}

/** Puts `orientation` back into a JPEG whose EXIF orientation was reset to 1 (or removed). */
function withOrientation(
  jpeg: Uint8Array<ArrayBuffer>,
  orientation: number,
): Uint8Array<ArrayBuffer> {
  const { segments, scan } = parseJpeg(jpeg);
  const exif = segments.find(isExif);
  // Segment data are views into `jpeg`, so an in-place edit changes the file itself.
  if (exif && setOrientation(exif.data, orientation)) return jpeg;
  const added: JpegSegment = { marker: APP1, data: orientationOnlyExif(orientation) };
  const rest = segments.filter((s) => s !== exif);
  const at = rest.findIndex((s) => s.marker !== APP0);
  const ordered = at < 0 ? [...rest, added] : [...rest.slice(0, at), added, ...rest.slice(at)];
  return writeJpeg(ordered, scan);
}

/**
 * The JPEG without its location data, ready to embed as it is. Its compressed image data is
 * unchanged and it keeps its EXIF orientation. Returns null when the file's header can't be
 * read safely — the caller should re-encode it instead of embedding it as it is.
 */
export async function stripLocation(jpeg: Blob): Promise<Blob | null> {
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  let segments: JpegSegment[];
  try {
    ({ segments } = parseJpeg(bytes));
  } catch (e) {
    if (e instanceof JpegFormatError) return null;
    throw e;
  }
  const exifSegment = segments.find(isExif);
  const exif = exifSegment ? exifSegment.data.slice().buffer : undefined;
  const orientation = exifSegment ? orientationOf(exifSegment.data) : 1;

  const stripped = await applyMetadataDetailed(
    new Blob([bytes], { type: 'image/jpeg' }),
    { orientation, hasLocation: true, exif },
    'strip-location',
  );
  if (orientation === 1) return stripped.blob;
  const out = new Uint8Array(await stripped.blob.arrayBuffer());
  return new Blob([withOrientation(out, orientation)], { type: 'image/jpeg' });
}
