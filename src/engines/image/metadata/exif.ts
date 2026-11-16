/**
 * Edits an EXIF (TIFF-structured) block in place on a copy, so every offset — including those
 * inside camera maker notes — stays valid. Removed data is zeroed, not just unlinked, so a
 * stripped GPS position can't be recovered from the bytes. All reads are bounds-checked;
 * malformed input throws `ExifFormatError`.
 */
import { SIGNATURE, startsWith } from './jpeg-segments';
import { metadataStrings as t } from './strings';

export class ExifFormatError extends Error {
  override readonly name = 'ExifFormatError';
  constructor(detail: string) {
    super(t.badExif(detail));
  }
}

export const TAG = {
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  interopIfd: 0xa005,
  thumbnailOffset: 0x0201,
  thumbnailLength: 0x0202,
  stripOffsets: 0x0111,
  stripByteCounts: 0x0117,
} as const;

/** Bytes per value for each TIFF field type (1–13). */
const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};

/** Most entries any real IFD has is a few hundred; more means garbage. */
const MAX_ENTRIES = 1000;

class Tiff {
  readonly view: DataView;
  readonly little: boolean;
  constructor(readonly bytes: Uint8Array<ArrayBuffer>) {
    if (bytes.length < 8) throw new ExifFormatError('too short');
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = this.view.getUint16(0);
    if (order === 0x4949) this.little = true;
    else if (order === 0x4d4d) this.little = false;
    else throw new ExifFormatError('unknown byte order');
    if (this.u16(2) !== 42) throw new ExifFormatError('not a TIFF structure');
  }
  get length(): number {
    return this.bytes.length;
  }
  private check(offset: number, size: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + size > this.bytes.length) {
      throw new ExifFormatError('a field points outside the block');
    }
  }
  u16(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(offset, this.little);
  }
  u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, this.little);
  }
  setU16(offset: number, v: number): void {
    this.check(offset, 2);
    this.view.setUint16(offset, v, this.little);
  }
  setU32(offset: number, v: number): void {
    this.check(offset, 4);
    this.view.setUint32(offset, v, this.little);
  }
  zero(offset: number, size: number): void {
    // Only zero what is really inside the block; out-of-range parts are ignored.
    const start = Math.max(0, Math.min(offset, this.bytes.length));
    const end = Math.max(start, Math.min(offset + size, this.bytes.length));
    this.bytes.fill(0, start, end);
  }
}

interface Entry {
  /** Byte offset of the 12-byte entry. */
  at: number;
  tag: number;
  type: number;
  count: number;
  /** Total value size in bytes, or -1 for an unknown type. */
  size: number;
  /** Where the value lives: inside the entry (size ≤ 4) or at an offset in the block. */
  valueAt: number;
}

interface Ifd {
  at: number;
  entries: Entry[];
  /** Offset of the 4-byte "next IFD" pointer. */
  nextAt: number;
  next: number;
}

function readIfd(tiff: Tiff, at: number): Ifd {
  if (at < 8) throw new ExifFormatError('a directory points into the header');
  const count = tiff.u16(at);
  if (count > MAX_ENTRIES) throw new ExifFormatError('a directory has too many entries');
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 12;
    const tag = tiff.u16(e);
    const type = tiff.u16(e + 2);
    const n = tiff.u32(e + 4);
    const unit = TYPE_SIZE[type];
    const size = unit === undefined ? -1 : unit * n;
    const valueAt = size >= 0 && size <= 4 ? e + 8 : tiff.u32(e + 8);
    entries.push({ at: e, tag, type, count: n, size, valueAt });
  }
  const nextAt = at + 2 + count * 12;
  // Some writers omit the final "next IFD" pointer at the very end of the block.
  const next = nextAt + 4 <= tiff.length ? tiff.u32(nextAt) : 0;
  return { at, entries, nextAt, next };
}

/** Offset of a sub-directory (EXIF, GPS, interop) linked from `ifd`, or 0 if none. */
function subIfd(tiff: Tiff, ifd: Ifd, tag: number): number {
  const e = ifd.entries.find((x) => x.tag === tag);
  if (!e) return 0;
  if ((e.type !== 4 && e.type !== 13) || e.count !== 1) throw new ExifFormatError('bad directory link');
  return tiff.u32(e.at + 8);
}

/** Zeroes a directory, its values stored outside the entries, and (for IFD1) the thumbnail. */
function eraseIfd(tiff: Tiff, ifd: Ifd): void {
  const value = (tag: number) => {
    const e = ifd.entries.find((x) => x.tag === tag);
    return e && e.count === 1 && (e.type === 3 || e.type === 4) ? (e.type === 3 ? tiff.u16(e.at + 8) : tiff.u32(e.at + 8)) : undefined;
  };
  for (const [offTag, lenTag] of [
    [TAG.thumbnailOffset, TAG.thumbnailLength],
    [TAG.stripOffsets, TAG.stripByteCounts],
  ] as const) {
    const off = value(offTag);
    const len = value(lenTag);
    if (off !== undefined && len !== undefined) tiff.zero(off, len);
  }
  for (const e of ifd.entries) {
    if (e.size > 4) tiff.zero(e.valueAt, e.size);
  }
  tiff.zero(ifd.at, 2 + ifd.entries.length * 12 + 4);
}

/** Removes one entry from a directory: later entries and the next pointer move up 12 bytes. */
function removeEntry(tiff: Tiff, ifd: Ifd, tag: number): void {
  const index = ifd.entries.findIndex((x) => x.tag === tag);
  if (index < 0) return;
  const count = ifd.entries.length;
  const from = ifd.at + 2 + (index + 1) * 12;
  const end = Math.min(ifd.nextAt + 4, tiff.length);
  tiff.bytes.copyWithin(from - 12, from, end);
  tiff.zero(end - 12, 12);
  tiff.setU16(ifd.at, count - 1);
}

/** Accepts an APP1 payload ("Exif\0\0" + TIFF) or bare TIFF bytes; returns a TIFF copy. */
export function exifToTiff(block: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = block instanceof Uint8Array ? block : new Uint8Array(block);
  const body = startsWith(bytes, SIGNATURE.exif) ? bytes.subarray(SIGNATURE.exif.length) : bytes;
  const copy = new Uint8Array(body.length);
  copy.set(body);
  return copy;
}

export interface ExifInfo {
  orientation: number | undefined;
  hasGps: boolean;
  hasThumbnail: boolean;
  /** Tags in IFD0, in file order. */
  ifd0Tags: number[];
}

/** Reads what the tests and the UI care about. */
export function readExifInfo(tiffBytes: Uint8Array<ArrayBuffer>): ExifInfo {
  const tiff = new Tiff(tiffBytes);
  const ifd0 = readIfd(tiff, tiff.u32(4));
  const o = ifd0.entries.find((e) => e.tag === TAG.orientation);
  return {
    orientation: o && o.type === 3 ? tiff.u16(o.at + 8) : o ? tiff.u32(o.at + 8) : undefined,
    hasGps: ifd0.entries.some((e) => e.tag === TAG.gpsIfd),
    hasThumbnail: ifd0.next !== 0,
    ifd0Tags: ifd0.entries.map((e) => e.tag),
  };
}

export interface PrepareExifOptions {
  /** Remove the GPS directory and zero its data (strip-location). */
  removeGps: boolean;
}

/**
 * Makes an EXIF block safe to write into an output whose pixels are already upright:
 * - Orientation (IFD0) is set to 1.
 * - The embedded thumbnail (IFD1) is removed: it shows the original, un-rotated, un-cropped image.
 * - With `removeGps`, the GPS directory is unlinked and every byte of it zeroed.
 *
 * Takes TIFF bytes from `exifToTiff` and edits them in place. Throws `ExifFormatError`.
 */
export function prepareExif(tiffBytes: Uint8Array<ArrayBuffer>, o: PrepareExifOptions): Uint8Array<ArrayBuffer> {
  const tiff = new Tiff(tiffBytes);
  const ifd0At = tiff.u32(4);
  const ifd0 = readIfd(tiff, ifd0At);

  // Read every directory first, so a damaged block fails before anything is changed.
  const visited = new Set<number>([ifd0At]);
  const follow = (at: number): Ifd | null => {
    if (at === 0) return null;
    if (visited.has(at)) throw new ExifFormatError('directories loop back on themselves');
    visited.add(at);
    return readIfd(tiff, at);
  };
  const exifIfd = follow(subIfd(tiff, ifd0, TAG.exifIfd));
  if (exifIfd) follow(subIfd(tiff, exifIfd, TAG.interopIfd));
  const gps = o.removeGps ? follow(subIfd(tiff, ifd0, TAG.gpsIfd)) : null;
  const ifd1 = ifd0.next !== 0 && ifd0.next !== ifd0At ? follow(ifd0.next) : null;

  // Orientation: the output pixels are already upright.
  const orientation = ifd0.entries.find((e) => e.tag === TAG.orientation);
  if (orientation) {
    tiff.setU16(orientation.at + 2, 3); // SHORT
    tiff.setU32(orientation.at + 4, 1); // one value
    tiff.setU32(orientation.at + 8, 0);
    tiff.setU16(orientation.at + 8, 1);
  }

  if (ifd1) eraseIfd(tiff, ifd1);
  if (ifd0.nextAt + 4 <= tiff.length) tiff.setU32(ifd0.nextAt, 0);

  if (o.removeGps) {
    if (gps) eraseIfd(tiff, gps);
    removeEntry(tiff, ifd0, TAG.gpsIfd);
  }
  return tiffBytes;
}
