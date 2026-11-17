// PNG decoder in plain TypeScript, for workers without OffscreenCanvas (older Safari).
// Every colour type and bit depth (1–16), PLTE + tRNS, Adam7 interlacing; 16-bit samples keep
// their high byte, like Chromium. zlib data goes through the browser's DecompressionStream (inflate.ts).
// Colour chunks (sRGB, gAMA, cHRM) are reported so the caller converts colours like a browser;
// the iCCP profile is read by container.ts.

import type { Chromaticities } from './color';
import { crc32 } from './crc32';
import { inflate } from './inflate';
import { checkDimensions, PixelDecodeError, type RawImage } from './raw';

export interface PngDecoded {
  image: RawImage;
  /** An sRGB chunk is present: the pixels are sRGB, whatever gAMA / cHRM say. */
  srgb: boolean;
  /** An iCCP chunk is present (container.ts reads the profile itself). */
  iccp: boolean;
  /** The gAMA value: the file's encoding gamma (e.g. 0.45455), when present and valid. */
  gamma?: number;
  chromaticities?: Chromaticities;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Allowed bit depths for each colour type. */
const DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16], // grey
  2: [8, 16], // RGB
  3: [1, 2, 4, 8], // palette
  4: [8, 16], // grey + alpha
  6: [8, 16], // RGBA
};
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Adam7 passes: x start, y start, x step, y step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface Header {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlaced: boolean;
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}
function u16(b: Uint8Array, at: number): number {
  return (b[at]! << 8) | b[at + 1]!;
}

/** Decodes a PNG file to straight RGBA. Throws {@link PixelDecodeError}. */
export async function decodePng(bytes: Uint8Array, maxPixels: number): Promise<PngDecoded> {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) {
    throw new PixelDecodeError('not a PNG');
  }
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let idatBytes = 0;
  const out: Omit<PngDecoded, 'image'> = { srgb: false, iccp: false };
  let chrm: Chromaticities | undefined;
  let ended = false;

  let at = 8;
  while (at + 12 <= bytes.length) {
    const len = u32(bytes, at);
    if (len > bytes.length - at - 12) throw new PixelDecodeError('chunk runs past the end');
    const typeAndData = bytes.subarray(at + 4, at + 8 + len);
    const type = String.fromCharCode(...typeAndData.subarray(0, 4));
    const data = typeAndData.subarray(4);
    const critical = type === 'IHDR' || type === 'PLTE' || type === 'IDAT';
    const crcOk = crc32(typeAndData) === u32(bytes, at + 8 + len);
    at += 12 + len;
    if (!crcOk) {
      if (critical) throw new PixelDecodeError(`bad CRC in ${type}`);
      continue; // a damaged ancillary chunk is skipped, as libpng does
    }
    if (!header && type !== 'IHDR') throw new PixelDecodeError('IHDR is not the first chunk');
    switch (type) {
      case 'IHDR':
        if (header) throw new PixelDecodeError('second IHDR');
        header = readHeader(data);
        checkDimensions(header.width, header.height, maxPixels);
        break;
      case 'PLTE':
        if (data.length === 0 || data.length % 3 !== 0 || data.length > 768) {
          throw new PixelDecodeError('bad PLTE');
        }
        palette ??= data;
        break;
      case 'tRNS':
        trns ??= data;
        break;
      case 'IDAT':
        idat.push(data);
        idatBytes += data.length;
        break;
      case 'sRGB':
        out.srgb = true;
        break;
      case 'iCCP':
        out.iccp = true;
        break;
      case 'gAMA':
        if (data.length === 4 && u32(data, 0) > 0) out.gamma = u32(data, 0) / 100000;
        break;
      case 'cHRM':
        if (data.length === 32) {
          const xy = (i: number): [number, number] => [
            u32(data, i * 8) / 100000,
            u32(data, i * 8 + 4) / 100000,
          ];
          chrm = { white: xy(0), red: xy(1), green: xy(2), blue: xy(3) };
        }
        break;
      case 'IEND':
        ended = true;
        break;
    }
    if (ended) break;
  }
  if (!header) throw new PixelDecodeError('no IHDR');
  if (idat.length === 0) throw new PixelDecodeError('no image data');
  if (header.colorType === 3 && !palette) throw new PixelDecodeError('palette image without PLTE');
  if (chrm) out.chromaticities = chrm;

  const passes = passSizes(header);
  const needed = passes.reduce((n, p) => n + p.bytes, 0);
  const compressed = idat.length === 1 ? idat[0]! : concat(idat, idatBytes);
  let raw: Uint8Array;
  try {
    raw = await inflate(compressed, needed);
  } catch {
    throw new PixelDecodeError('broken image data');
  }
  if (raw.length < needed) throw new PixelDecodeError('image data is truncated');

  const image: RawImage = {
    width: header.width,
    height: header.height,
    data: new Uint8ClampedArray(header.width * header.height * 4),
  };
  const writer = rowWriter(header, image, palette, trns);
  let offset = 0;
  for (const pass of passes) {
    if (pass.bytes === 0) continue;
    unfilter(raw, offset, pass.rowBytes, pass.rows, header);
    for (let r = 0; r < pass.rows; r++) {
      const y = pass.y0 + r * pass.dy;
      writer(raw, offset + r * (pass.rowBytes + 1) + 1, pass.cols, y, pass.x0, pass.dx);
    }
    offset += pass.bytes;
  }
  return { image, ...out };
}

function readHeader(d: Uint8Array): Header {
  if (d.length !== 13) throw new PixelDecodeError('bad IHDR');
  const width = u32(d, 0);
  const height = u32(d, 4);
  const depth = d[8]!;
  const colorType = d[9]!;
  if (width > 0x7fffffff || height > 0x7fffffff) throw new PixelDecodeError('bad size');
  if (!DEPTHS[colorType]?.includes(depth)) {
    throw new PixelDecodeError(`bad colour type ${colorType} / depth ${depth}`);
  }
  if (d[10] !== 0 || d[11] !== 0 || d[12]! > 1) {
    throw new PixelDecodeError('unknown compression, filter or interlace method');
  }
  return { width, height, depth, colorType, interlaced: d[12] === 1 };
}

interface Pass {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  cols: number;
  rows: number;
  /** Bytes per row, without the filter byte. */
  rowBytes: number;
  /** Bytes of the whole pass, filter bytes included. */
  bytes: number;
}

function passSizes(h: Header): Pass[] {
  const bitsPerPixel = h.depth * CHANNELS[h.colorType]!;
  const make = (x0: number, y0: number, dx: number, dy: number): Pass => {
    const cols = h.width > x0 ? Math.ceil((h.width - x0) / dx) : 0;
    const rows = h.height > y0 ? Math.ceil((h.height - y0) / dy) : 0;
    const rowBytes = Math.ceil((cols * bitsPerPixel) / 8);
    const bytes = cols > 0 && rows > 0 ? rows * (rowBytes + 1) : 0;
    return { x0, y0, dx, dy, cols, rows, rowBytes, bytes };
  };
  return h.interlaced ? ADAM7.map(([x0, y0, dx, dy]) => make(x0, y0, dx, dy)) : [make(0, 0, 1, 1)];
}

/** Reverses the per-row filters in place. Rows start with their filter-type byte. */
function unfilter(b: Uint8Array, start: number, rowBytes: number, rows: number, h: Header): void {
  const bpp = Math.max(1, (h.depth * CHANNELS[h.colorType]!) >> 3);
  const stride = rowBytes + 1;
  for (let r = 0; r < rows; r++) {
    const row = start + r * stride + 1;
    const prev = r > 0 ? row - stride : -1; // -1: the row above is all zeros
    const filter = b[row - 1]!;
    switch (filter) {
      case 0:
        break;
      case 1:
        for (let i = bpp; i < rowBytes; i++) b[row + i] = (b[row + i]! + b[row + i - bpp]!) & 0xff;
        break;
      case 2:
        if (prev < 0) break;
        for (let i = 0; i < rowBytes; i++) b[row + i] = (b[row + i]! + b[prev + i]!) & 0xff;
        break;
      case 3:
        for (let i = 0; i < rowBytes; i++) {
          const left = i >= bpp ? b[row + i - bpp]! : 0;
          const up = prev >= 0 ? b[prev + i]! : 0;
          b[row + i] = (b[row + i]! + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? b[row + i - bpp]! : 0;
          const up = prev >= 0 ? b[prev + i]! : 0;
          const c = prev >= 0 && i >= bpp ? b[prev + i - bpp]! : 0;
          const p = a + up - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
          b[row + i] = (b[row + i]! + pred) & 0xff;
        }
        break;
      default:
        throw new PixelDecodeError(`unknown filter type ${filter}`);
    }
  }
}

/** 16-bit sample → 8 bits: the high byte, exactly as Chromium's PNG decoder does. */
function to8(v: number): number {
  return v >> 8;
}

type RowWriter = (
  src: Uint8Array,
  at: number,
  cols: number,
  y: number,
  x0: number,
  dx: number,
) => void;

/** Builds the function that turns one unfiltered row into RGBA pixels of the output. */
function rowWriter(
  h: Header,
  img: RawImage,
  palette: Uint8Array | undefined,
  trns: Uint8Array | undefined,
): RowWriter {
  const out = img.data;
  const w = img.width;
  const { depth, colorType } = h;
  const wide = depth === 16;

  if (colorType === 3) {
    const pal = palette!;
    const entries = pal.length / 3;
    // RGBA lookup: missing entries are opaque black, missing tRNS values opaque.
    const lut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      if (i < entries) lut.set(pal.subarray(i * 3, i * 3 + 3), i * 4);
      lut[i * 4 + 3] = trns && i < trns.length ? trns[i]! : 255;
    }
    return (src, at, cols, y, x0, dx) => {
      let o = (y * w + x0) * 4;
      const step = dx * 4;
      for (let x = 0; x < cols; x++, o += step) {
        const idx = sample(src, at, x, depth) * 4;
        out[o] = lut[idx]!;
        out[o + 1] = lut[idx + 1]!;
        out[o + 2] = lut[idx + 2]!;
        out[o + 3] = lut[idx + 3]!;
      }
    };
  }

  if (colorType === 0) {
    const key = trns && trns.length >= 2 ? u16(trns, 0) : -1;
    const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
    return (src, at, cols, y, x0, dx) => {
      let o = (y * w + x0) * 4;
      const step = dx * 4;
      for (let x = 0; x < cols; x++, o += step) {
        const v = wide ? u16(src, at + x * 2) : sample(src, at, x, depth);
        const g = wide ? to8(v) : depth < 8 ? Math.round(v * scale) : v;
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = v === key ? 0 : 255;
      }
    };
  }

  if (colorType === 2) {
    const hasKey = !!trns && trns.length >= 6;
    const kr = hasKey ? u16(trns, 0) : -1;
    const kg = hasKey ? u16(trns, 2) : -1;
    const kb = hasKey ? u16(trns, 4) : -1;
    return (src, at, cols, y, x0, dx) => {
      let o = (y * w + x0) * 4;
      const step = dx * 4;
      for (let x = 0; x < cols; x++, o += step) {
        let r: number, g: number, b: number;
        if (wide) {
          const s = at + x * 6;
          r = u16(src, s);
          g = u16(src, s + 2);
          b = u16(src, s + 4);
          out[o] = to8(r);
          out[o + 1] = to8(g);
          out[o + 2] = to8(b);
        } else {
          const s = at + x * 3;
          r = src[s]!;
          g = src[s + 1]!;
          b = src[s + 2]!;
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
        }
        out[o + 3] = hasKey && r === kr && g === kg && b === kb ? 0 : 255;
      }
    };
  }

  if (colorType === 4) {
    return (src, at, cols, y, x0, dx) => {
      let o = (y * w + x0) * 4;
      const step = dx * 4;
      for (let x = 0; x < cols; x++, o += step) {
        let g: number, a: number;
        if (wide) {
          g = to8(u16(src, at + x * 4));
          a = to8(u16(src, at + x * 4 + 2));
        } else {
          g = src[at + x * 2]!;
          a = src[at + x * 2 + 1]!;
        }
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = a;
      }
    };
  }

  // colorType 6: RGBA
  return (src, at, cols, y, x0, dx) => {
    let o = (y * w + x0) * 4;
    if (!wide && dx === 1) {
      out.set(src.subarray(at, at + cols * 4), o);
      return;
    }
    const step = dx * 4;
    for (let x = 0; x < cols; x++, o += step) {
      if (wide) {
        const s = at + x * 8;
        out[o] = to8(u16(src, s));
        out[o + 1] = to8(u16(src, s + 2));
        out[o + 2] = to8(u16(src, s + 4));
        out[o + 3] = to8(u16(src, s + 6));
      } else {
        const s = at + x * 4;
        out[o] = src[s]!;
        out[o + 1] = src[s + 1]!;
        out[o + 2] = src[s + 2]!;
        out[o + 3] = src[s + 3]!;
      }
    }
  };
}

/** Sample `x` of a row packed at 1, 2, 4 or 8 bits (most significant bits first). */
function sample(src: Uint8Array, at: number, x: number, depth: number): number {
  if (depth === 8) return src[at + x]!;
  const bit = x * depth;
  const shift = 8 - depth - (bit & 7);
  return (src[at + (bit >> 3)]! >> shift) & ((1 << depth) - 1);
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
