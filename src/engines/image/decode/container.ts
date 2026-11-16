// Reads what we need from an image file's container without decoding pixels:
// the real format (from the first bytes, never the extension), the stored pixel size
// (so huge images are refused before decoding), the raw EXIF block and the ICC profile.

export type SniffedFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'bmp' | 'unknown';

/** Colour description from an ISO-BMFF `colr` box of type `nclx` (HEIC / AVIF without an ICC profile). */
export interface Nclx {
  primaries: number;
  transfer: number;
}

/**
 * One container-level transform of HEIF/AVIF, in the order it must be applied.
 * `rotate` (irot): anti-clockwise degrees. `mirror` (imir): 'vertical-axis' swaps left and right,
 * 'horizontal-axis' swaps top and bottom.
 */
export type IsoTransform =
  { rotate: 90 | 180 | 270 } | { mirror: 'vertical-axis' | 'horizontal-axis' };

export interface ContainerInfo {
  format: SniffedFormat;
  /** Stored size, before any orientation is applied. Missing if the header couldn't be read. */
  width?: number;
  height?: number;
  /** TIFF-structured EXIF data, starting at the byte-order mark ("II" / "MM"). */
  exif?: Uint8Array;
  icc?: Uint8Array;
  nclx?: Nclx;
  transforms?: IsoTransform[];
}

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && at + i < b.length; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
}

function startsWith(b: Uint8Array, at: number, bytes: readonly number[]): boolean {
  return bytes.every((v, i) => b[at + i] === v);
}

/** Detects the format from the first bytes. */
export function sniffFormat(b: Uint8Array): SniffedFormat {
  if (startsWith(b, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  const head6 = ascii(b, 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 2) === 'BM' && b.length >= 26) {
    const dibSize = readU32LE(b, 14);
    if ([12, 40, 52, 56, 64, 108, 124].includes(dibSize)) return 'bmp';
  }
  if (ascii(b, 4, 4) === 'ftyp') return isoBrand(b);
  return 'unknown';
}

function isoBrand(b: Uint8Array): SniffedFormat {
  const size = readU32BE(b, 0);
  const major = ascii(b, 8, 4);
  const brands = [major];
  for (let at = 16; at + 4 <= Math.min(size, b.length); at += 4) brands.push(ascii(b, at, 4));
  if (AVIF_BRANDS.has(major)) return 'avif';
  if (HEIF_BRANDS.has(major) && major !== 'mif1' && major !== 'msf1') return 'heic';
  if (brands.some((x) => AVIF_BRANDS.has(x))) return 'avif';
  if (brands.some((x) => HEIF_BRANDS.has(x))) return 'heic';
  return 'unknown';
}

function readU16BE(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
}
function readU32BE(b: Uint8Array, at: number): number {
  return (
    (((b[at] ?? 0) << 24) |
      ((b[at + 1] ?? 0) << 16) |
      ((b[at + 2] ?? 0) << 8) |
      (b[at + 3] ?? 0)) >>>
    0
  );
}
function readU16LE(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}
function readU24LE(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
}
function readU32LE(b: Uint8Array, at: number): number {
  return (readU16LE(b, at) | (readU16LE(b, at + 2) << 16)) >>> 0;
}
function readUintBE(b: Uint8Array, at: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + (b[at + i] ?? 0);
  return v;
}

/** Drops the "Exif\0\0" prefix some writers put before the TIFF header. */
function tiffStart(block: Uint8Array): Uint8Array | undefined {
  let data = block;
  if (ascii(data, 0, 4) === 'Exif') data = data.subarray(6);
  const bom = ascii(data, 0, 2);
  return bom === 'II' || bom === 'MM' ? data : undefined;
}

/** Inflates zlib data (PNG iCCP) with the browser's built-in decompressor. */
async function inflate(data: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Reads format, stored size and metadata blocks. Never throws on malformed data; missing parts are left out. */
export async function readContainer(b: Uint8Array): Promise<ContainerInfo> {
  const format = sniffFormat(b);
  try {
    switch (format) {
      case 'jpeg':
        return { format, ...readJpeg(b) };
      case 'png':
        return { format, ...(await readPng(b)) };
      case 'webp':
        return { format, ...readWebp(b) };
      case 'gif':
        return { format, width: readU16LE(b, 6), height: readU16LE(b, 8) };
      case 'bmp':
        return { format, ...readBmp(b) };
      case 'avif':
      case 'heic':
        return { format, ...readIsoBmff(b) };
      default:
        return { format };
    }
  } catch {
    return { format };
  }
}

type Parts = Omit<ContainerInfo, 'format'>;

function readJpeg(b: Uint8Array): Parts {
  const out: Parts = {};
  const iccChunks: Array<{ seq: number; data: Uint8Array }> = [];
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) break;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = readU16BE(b, at + 2);
    const data = b.subarray(at + 4, at + 2 + len);
    if (marker === 0xe1 && !out.exif && ascii(data, 0, 6) === 'Exif\0\0') {
      out.exif = tiffStart(data);
    } else if (marker === 0xe2 && ascii(data, 0, 12) === 'ICC_PROFILE\0') {
      iccChunks.push({ seq: data[12] ?? 0, data: data.subarray(14) });
    } else if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      out.height = readU16BE(b, at + 5);
      out.width = readU16BE(b, at + 7);
    }
    at += 2 + len;
  }
  if (iccChunks.length > 0)
    out.icc = concat(iccChunks.sort((x, y) => x.seq - y.seq).map((c) => c.data));
  return out;
}

async function readPng(b: Uint8Array): Promise<Parts> {
  const out: Parts = {};
  let at = 8;
  while (at + 8 <= b.length) {
    const len = readU32BE(b, at);
    const type = ascii(b, at + 4, 4);
    const data = b.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      out.width = readU32BE(data, 0);
      out.height = readU32BE(data, 4);
    } else if (type === 'eXIf') {
      out.exif = tiffStart(data);
    } else if (type === 'iCCP') {
      const nul = data.indexOf(0);
      if (nul > 0 && data[nul + 1] === 0) out.icc = await inflate(data.subarray(nul + 2));
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + len;
  }
  return out;
}

function readWebp(b: Uint8Array): Parts {
  const out: Parts = {};
  let at = 12;
  while (at + 8 <= b.length) {
    const type = ascii(b, at, 4);
    const len = readU32LE(b, at + 4);
    const data = b.subarray(at + 8, at + 8 + len);
    if (type === 'VP8X') {
      out.width = readU24LE(data, 4) + 1;
      out.height = readU24LE(data, 7) + 1;
    } else if (type === 'VP8 ' && out.width === undefined) {
      out.width = readU16LE(data, 6) & 0x3fff;
      out.height = readU16LE(data, 8) & 0x3fff;
    } else if (type === 'VP8L' && out.width === undefined) {
      const bits = readU32LE(data, 1);
      out.width = (bits & 0x3fff) + 1;
      out.height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === 'EXIF') {
      out.exif = tiffStart(data);
    } else if (type === 'ICCP') {
      out.icc = data;
    }
    at += 8 + len + (len % 2);
  }
  return out;
}

function readBmp(b: Uint8Array): Parts {
  const dibSize = readU32LE(b, 14);
  if (dibSize === 12) return { width: readU16LE(b, 18), height: readU16LE(b, 20) };
  const height = readU32LE(b, 22) | 0; // negative = top-down
  return { width: readU32LE(b, 18) | 0, height: Math.abs(height) };
}

// ---------- ISO-BMFF (HEIC / AVIF) ----------

interface Box {
  type: string;
  /** Start of the box payload (after the header). */
  start: number;
  /** End of the box (exclusive). */
  end: number;
}

function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const list: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = readU32BE(b, at);
    const type = ascii(b, at + 4, 4);
    let header = 8;
    if (size === 1) {
      size = readUintBE(b, at + 8, 8);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header) break;
    list.push({ type, start: at + header, end: Math.min(at + size, to) });
    at += size;
  }
  return list;
}

function child(b: Uint8Array, parent: Box, type: string, fullBox = false): Box | undefined {
  return boxes(b, parent.start + (fullBox ? 4 : 0), parent.end).find((x) => x.type === type);
}

interface Extent {
  offset: number;
  length: number;
}

function readIsoBmff(b: Uint8Array): Parts {
  const out: Parts = {};
  const meta = boxes(b, 0, b.length).find((x) => x.type === 'meta');
  if (!meta) return out;
  const metaChildren = boxes(b, meta.start + 4, meta.end);
  const find = (type: string) => metaChildren.find((x) => x.type === type);

  const pitm = find('pitm');
  const primary = pitm
    ? b[pitm.start] === 0
      ? readU16BE(b, pitm.start + 4)
      : readU32BE(b, pitm.start + 4)
    : undefined;

  // Item properties of the primary item: size, colour, rotation, mirror.
  const iprp = find('iprp');
  const ipco = iprp ? child(b, iprp, 'ipco') : undefined;
  if (ipco) {
    const props = boxes(b, ipco.start, ipco.end);
    const ipma = iprp ? child(b, iprp, 'ipma') : undefined;
    const assoc = ipma && primary !== undefined ? primaryAssociations(b, ipma, primary) : undefined;
    const mine = assoc
      ? assoc.map((i) => props[i - 1]).filter((p): p is Box => p !== undefined)
      : props;
    const readColour = (p: Box) => {
      const kind = ascii(b, p.start, 4);
      if ((kind === 'prof' || kind === 'rICC') && !out.icc)
        out.icc = b.subarray(p.start + 4, p.end);
      else if (kind === 'nclx' && !out.nclx)
        out.nclx = { primaries: readU16BE(b, p.start + 4), transfer: readU16BE(b, p.start + 6) };
    };
    for (const p of mine) {
      if (p.type === 'ispe') {
        const w = readU32BE(b, p.start + 4);
        const h = readU32BE(b, p.start + 8);
        if (!assoc && out.width !== undefined && w * h <= out.width * (out.height ?? 0)) continue;
        out.width = w;
        out.height = h;
      } else if (p.type === 'colr') {
        readColour(p);
      } else if (p.type === 'irot' && assoc) {
        const quarter = (b[p.start] ?? 0) & 3;
        if (quarter !== 0)
          (out.transforms ??= []).push({ rotate: (quarter * 90) as 90 | 180 | 270 });
      } else if (p.type === 'imir' && assoc) {
        const axis = (b[p.start] ?? 0) & 1;
        (out.transforms ??= []).push({ mirror: axis === 0 ? 'vertical-axis' : 'horizontal-axis' });
      }
    }
    // Grid images (iPhone HEIC) often attach the colour profile to the tiles, not the grid item.
    if (!out.icc && !out.nclx) for (const p of props) if (p.type === 'colr') readColour(p);
  }

  // EXIF item: located through iinf (item type 'Exif') and iloc (where its bytes are).
  const iinf = find('iinf');
  const iloc = find('iloc');
  if (iinf && iloc) {
    const exifId = exifItemId(b, iinf);
    const idat = find('idat');
    const extents = exifId !== undefined ? itemExtents(b, iloc, exifId, idat) : undefined;
    if (extents && extents.length > 0) {
      const data = concat(extents.map((e) => b.subarray(e.offset, e.offset + e.length)));
      const shift = 4 + readU32BE(data, 0);
      out.exif = tiffStart(data.subarray(shift));
    }
  }
  return out;
}

function primaryAssociations(b: Uint8Array, ipma: Box, primary: number): number[] | undefined {
  const version = b[ipma.start] ?? 0;
  const flags = readUintBE(b, ipma.start + 1, 3);
  let at = ipma.start + 4;
  const count = readU32BE(b, at);
  at += 4;
  for (let i = 0; i < count && at < ipma.end; i++) {
    const id = version < 1 ? readU16BE(b, at) : readU32BE(b, at);
    at += version < 1 ? 2 : 4;
    const n = b[at] ?? 0;
    at += 1;
    const indexes: number[] = [];
    for (let j = 0; j < n; j++) {
      if (flags & 1) {
        indexes.push(readU16BE(b, at) & 0x7fff);
        at += 2;
      } else {
        indexes.push((b[at] ?? 0) & 0x7f);
        at += 1;
      }
    }
    if (id === primary) return indexes;
  }
  return undefined;
}

function exifItemId(b: Uint8Array, iinf: Box): number | undefined {
  const version = b[iinf.start] ?? 0;
  const entriesStart = iinf.start + 4 + (version === 0 ? 2 : 4);
  for (const infe of boxes(b, entriesStart, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const v = b[infe.start] ?? 0;
    if (v < 2) continue;
    const id = v === 2 ? readU16BE(b, infe.start + 4) : readU32BE(b, infe.start + 4);
    const typeAt = infe.start + 4 + (v === 2 ? 2 : 4) + 2;
    if (ascii(b, typeAt, 4) === 'Exif') return id;
  }
  return undefined;
}

function itemExtents(
  b: Uint8Array,
  iloc: Box,
  itemId: number,
  idat: Box | undefined,
): Extent[] | undefined {
  const version = b[iloc.start] ?? 0;
  let at = iloc.start + 4;
  const sizes1 = b[at] ?? 0;
  const sizes2 = b[at + 1] ?? 0;
  at += 2;
  const offsetSize = sizes1 >> 4;
  const lengthSize = sizes1 & 15;
  const baseOffsetSize = sizes2 >> 4;
  const indexSize = version === 1 || version === 2 ? sizes2 & 15 : 0;
  const count = version < 2 ? readU16BE(b, at) : readU32BE(b, at);
  at += version < 2 ? 2 : 4;
  for (let i = 0; i < count && at < iloc.end; i++) {
    const id = version < 2 ? readU16BE(b, at) : readU32BE(b, at);
    at += version < 2 ? 2 : 4;
    let method = 0;
    if (version === 1 || version === 2) {
      method = readU16BE(b, at) & 15;
      at += 2;
    }
    at += 2; // data_reference_index
    const base = readUintBE(b, at, baseOffsetSize);
    at += baseOffsetSize;
    const extentCount = readU16BE(b, at);
    at += 2;
    const extents: Extent[] = [];
    for (let e = 0; e < extentCount; e++) {
      at += indexSize;
      const offset = readUintBE(b, at, offsetSize);
      at += offsetSize;
      const length = readUintBE(b, at, lengthSize);
      at += lengthSize;
      // A length of 0 means "to the end of the file".
      extents.push({ offset: base + offset, length: length || b.length - (base + offset) });
    }
    if (id !== itemId) continue;
    if (method === 1 && idat)
      return extents.map((e) => ({ offset: idat.start + e.offset, length: e.length }));
    if (method !== 0) return undefined;
    return extents;
  }
  return undefined;
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0]) return parts[0];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
