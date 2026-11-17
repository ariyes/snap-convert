// A small EXIF block for the output JPEG, built from the RAW file's EXIF (FlashRaw's standalone
// TIFF stream). RAW files carry maker notes, previews and sensor tags that are often far bigger than
// the 64 KB a JPEG EXIF segment can hold (Olympus: 1.4 MB, Nikon: 200 KB), so instead of dropping
// everything we keep what a photo's details are: camera, lens, exposure, dates, orientation, GPS
// (the pipeline's metadata policy still decides what is written and removes GPS on request).

/** IFD0 tags kept: description, make, model, orientation, resolution, software, date, artist, copyright. */
const IFD0_KEEP = new Set([
  0x010e, 0x010f, 0x0110, 0x0112, 0x011a, 0x011b, 0x0128, 0x0131, 0x0132, 0x013b, 0x8298,
]);
/** EXIF directory tags dropped: maker note, interop pointer, CFA pattern, sub-IFD pointers. */
const EXIF_DROP = new Set([0x927c, 0xa005, 0xa302, 0x014a]);
const EXIF_POINTER = 0x8769;
const GPS_POINTER = 0x8825;
/** Bigger values are never photo details (they are blobs: thumbnails, private data). */
const MAX_VALUE_BYTES = 4096;

const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** The value's raw bytes in the source byte order. */
  value: Uint8Array;
}

class Reader {
  readonly view: DataView;
  readonly little: boolean;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
    if (order !== 'II' && order !== 'MM') throw new RangeError('not a TIFF stream');
    this.little = order === 'II';
    if (this.u16(2) !== 42) throw new RangeError('not a TIFF stream');
  }
  u16(at: number): number {
    return this.view.getUint16(at, this.little);
  }
  u32(at: number): number {
    return this.view.getUint32(at, this.little);
  }
  /** Entries of the IFD at `at` (bounds-checked; damaged entries are skipped). */
  ifd(at: number): Entry[] {
    if (at < 8 || at + 2 > this.bytes.length) return [];
    const n = this.u16(at);
    const entries: Entry[] = [];
    for (let i = 0; i < n; i++) {
      const p = at + 2 + i * 12;
      if (p + 12 > this.bytes.length) break;
      const tag = this.u16(p);
      const type = this.u16(p + 2);
      const count = this.u32(p + 4);
      const size = (TYPE_SIZES[type] ?? 0) * count;
      if (!size || size > MAX_VALUE_BYTES) {
        if (tag === EXIF_POINTER || tag === GPS_POINTER) {
          entries.push({ tag, type, count, value: this.bytes.slice(p + 8, p + 12) });
        }
        continue;
      }
      const from = size <= 4 ? p + 8 : this.u32(p + 8);
      if (from + size > this.bytes.length) continue;
      entries.push({ tag, type, count, value: this.bytes.slice(from, from + size) });
    }
    return entries;
  }
  pointer(entries: Entry[], tag: number): number | undefined {
    const e = entries.find((x) => x.tag === tag);
    if (!e || e.value.length !== 4) return undefined;
    return new DataView(e.value.buffer, e.value.byteOffset, 4).getUint32(0, this.little);
  }
}

/** Serialises IFD0 (+ EXIF and GPS directories) in the source byte order. */
function write(
  little: boolean,
  ifd0: Entry[],
  exif: Entry[] | undefined,
  gps: Entry[] | undefined,
): Uint8Array<ArrayBuffer> {
  const dirs: Entry[][] = [ifd0, ...(exif ? [exif] : []), ...(gps ? [gps] : [])];
  const dirSize = (d: Entry[]) => 2 + d.length * 12 + 4;
  const dataSize = (d: Entry[]) =>
    d.reduce((s, e) => s + (e.value.length > 4 ? e.value.length + (e.value.length & 1) : 0), 0);
  // Layout: header, then each directory followed by its out-of-line values.
  const starts: number[] = [];
  let size = 8;
  for (const d of dirs) {
    starts.push(size);
    size += dirSize(d) + dataSize(d);
  }
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out.set(little ? [0x49, 0x49] : [0x4d, 0x4d]);
  v.setUint16(2, 42, little);
  v.setUint32(4, 8, little);
  const exifAt = exif ? starts[1] : undefined;
  const gpsAt = gps ? starts[exif ? 2 : 1] : undefined;
  dirs.forEach((d, di) => {
    const at = starts[di]!;
    let data = at + dirSize(d);
    v.setUint16(at, d.length, little);
    d.forEach((e, i) => {
      const p = at + 2 + i * 12;
      v.setUint16(p, e.tag, little);
      v.setUint16(p + 2, e.type, little);
      v.setUint32(p + 4, e.count, little);
      if (di === 0 && e.tag === EXIF_POINTER && exifAt !== undefined) {
        v.setUint32(p + 8, exifAt, little);
      } else if (di === 0 && e.tag === GPS_POINTER && gpsAt !== undefined) {
        v.setUint32(p + 8, gpsAt, little);
      } else if (e.value.length <= 4) {
        out.set(e.value, p + 8);
      } else {
        v.setUint32(p + 8, data, little);
        out.set(e.value, data);
        data += e.value.length + (e.value.length & 1);
      }
    });
    v.setUint32(at + 2 + d.length * 12, 0, little); // no next IFD (no thumbnail)
  });
  return out;
}

const byTag = (a: Entry, b: Entry) => a.tag - b.tag;

/**
 * A compact EXIF TIFF block (what follows "Exif\0\0" in a JPEG) with the photo's details from a
 * RAW file's EXIF stream, or undefined if the stream is unreadable or has nothing worth keeping.
 */
export function compactExif(tiff: Uint8Array): ArrayBuffer | undefined {
  let r: Reader;
  try {
    r = new Reader(tiff);
  } catch {
    return undefined;
  }
  try {
    const all0 = r.ifd(r.u32(4));
    const exifAt = r.pointer(all0, EXIF_POINTER);
    const gpsAt = r.pointer(all0, GPS_POINTER);
    const exif = exifAt
      ? r
          .ifd(exifAt)
          .filter((e) => !EXIF_DROP.has(e.tag) && e.type !== 13)
          .sort(byTag)
      : [];
    const gps = gpsAt
      ? r
          .ifd(gpsAt)
          .filter((e) => e.type !== 13)
          .sort(byTag)
      : [];
    const pointerEntry = (tag: number): Entry => ({
      tag,
      type: 4,
      count: 1,
      value: new Uint8Array(4),
    });
    const ifd0 = all0.filter((e) => IFD0_KEEP.has(e.tag));
    if (exif.length) ifd0.push(pointerEntry(EXIF_POINTER));
    if (gps.length) ifd0.push(pointerEntry(GPS_POINTER));
    ifd0.sort(byTag);
    if (!ifd0.length) return undefined;
    return write(r.little, ifd0, exif.length ? exif : undefined, gps.length ? gps : undefined)
      .buffer;
  } catch {
    return undefined;
  }
}
