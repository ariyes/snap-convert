// Test-only writers for PNG, GIF and BMP variants the fixtures don't cover (every PNG colour type
// and bit depth, all five filters, Adam7; GIF with real LZW, interlacing, offsets, local palettes;
// BMP palette / 16 / 32-bit / bit fields / top-down). Plain arrays, so they run in Node and browsers.
import { zlibSync } from 'fflate';
import { crc32 } from '../crc32';

// ---------- PNG ----------

export interface PngSpec {
  width: number;
  height: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  depth: 1 | 2 | 4 | 8 | 16;
  interlaced?: boolean;
  /** Raw sample values (at `depth`) for pixel x, y: one per channel. */
  samples: (x: number, y: number) => number[];
  palette?: Array<[number, number, number]>;
  trns?: Uint8Array;
  /** Extra chunks written before IDAT (e.g. gAMA, cHRM, iCCP, sRGB). */
  chunks?: Array<{ type: string; data: Uint8Array }>;
  /** Split the zlib stream over this many IDAT chunks. */
  idatCount?: number;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function u32be(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}

/** Writes a PNG, using filter type (row number mod 5) so all five filters are exercised. */
export function writePng(spec: PngSpec): Uint8Array {
  const { width, height, colorType, depth } = spec;
  const channels = CHANNELS[colorType];
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const passes = spec.interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const);
  const raw: number[] = [];
  let rowIndex = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const cols = width > x0 ? Math.ceil((width - x0) / dx) : 0;
    const rows = height > y0 ? Math.ceil((height - y0) / dy) : 0;
    if (cols === 0 || rows === 0) continue;
    const rowBytes = Math.ceil((cols * bitsPerPixel) / 8);
    let prev = new Uint8Array(rowBytes);
    for (let r = 0; r < rows; r++) {
      const row = new Uint8Array(rowBytes);
      let bit = 0;
      for (let c = 0; c < cols; c++) {
        for (const v of spec.samples(x0 + c * dx, y0 + r * dy)) {
          if (depth === 16) {
            row[bit >> 3] = v >> 8;
            row[(bit >> 3) + 1] = v & 0xff;
          } else if (depth === 8) {
            row[bit >> 3] = v;
          } else {
            row[bit >> 3]! |= v << (8 - depth - (bit & 7));
          }
          bit += depth;
        }
      }
      const filter = rowIndex++ % 5;
      raw.push(filter, ...filterRow(filter, row, prev, bpp));
      prev = row;
    }
  }
  const compressed = zlibSync(new Uint8Array(raw));
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([depth, colorType, 0, 0, spec.interlaced ? 1 : 0], 8);
  const parts: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...(spec.chunks ?? []).map((c) => pngChunk(c.type, c.data)),
  ];
  if (spec.palette) parts.push(pngChunk('PLTE', new Uint8Array(spec.palette.flat())));
  if (spec.trns) parts.push(pngChunk('tRNS', spec.trns));
  const n = Math.max(1, spec.idatCount ?? 1);
  const step = Math.ceil(compressed.length / n);
  for (let at = 0; at < compressed.length; at += step) {
    parts.push(pngChunk('IDAT', compressed.subarray(at, at + step)));
  }
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

function filterRow(filter: number, row: Uint8Array, prev: Uint8Array, bpp: number): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp]! : 0;
    const b = prev[i]!;
    const c = i >= bpp ? prev[i - bpp]! : 0;
    let pred = 0;
    if (filter === 1) pred = a;
    else if (filter === 2) pred = b;
    else if (filter === 3) pred = (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i] = (row[i]! - pred) & 0xff;
  }
  return out;
}

// ---------- GIF ----------

export interface GifSpec {
  width: number;
  height: number;
  /** Global palette (omit for none). */
  palette?: Array<[number, number, number]>;
  frame: {
    left?: number;
    top?: number;
    width: number;
    height: number;
    /** Palette index for frame pixel x, y. */
    index: (x: number, y: number) => number;
    localPalette?: Array<[number, number, number]>;
    interlaced?: boolean;
    transparent?: number;
  };
  /** A second, different frame after the first (must be ignored). */
  secondFrame?: boolean;
}

function tableBits(size: number): number {
  let bits = 1;
  while (1 << bits < size) bits++;
  return bits;
}

function colourTable(p: Array<[number, number, number]>): { flags: number; bytes: number[] } {
  const bits = tableBits(p.length);
  const bytes: number[] = [];
  for (let i = 0; i < 1 << bits; i++) bytes.push(...(p[i] ?? [0, 0, 0]));
  return { flags: 0x80 | (bits - 1), bytes };
}

/** Standard GIF LZW (variable code size, dictionary up to 4096, clear when full). */
export function lzwEncode(indices: number[], minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let size = minCodeSize + 1;
  let next = end + 1;
  let dict = new Map<string, number>();
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let current = '';
  let currentCode = -1;
  for (const k of indices) {
    const key = current === '' ? String(k) : `${current},${k}`;
    const known = current === '' ? k : dict.get(key);
    if (known !== undefined) {
      current = key;
      currentCode = known;
      continue;
    }
    emit(currentCode);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      size = minCodeSize + 1;
      next = end + 1;
    }
    current = String(k);
    currentCode = k;
  }
  if (currentCode >= 0) emit(currentCode);
  emit(end);
  if (bits > 0) out.push(acc & 0xff);
  return new Uint8Array(out);
}

export function writeGif(spec: GifSpec): Uint8Array {
  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 0xff, (v >> 8) & 0xff);
  for (const c of 'GIF89a') bytes.push(c.charCodeAt(0));
  u16(spec.width);
  u16(spec.height);
  const global = spec.palette ? colourTable(spec.palette) : undefined;
  bytes.push(global ? global.flags | 0x70 : 0, 0, 0);
  if (global) bytes.push(...global.bytes);
  const frames = spec.secondFrame ? [spec.frame, { ...spec.frame, index: () => 1 }] : [spec.frame];
  for (const f of frames) {
    const t = f.transparent;
    bytes.push(0x21, 0xf9, 4, t !== undefined ? 1 : 0, 10, 0, t ?? 0, 0);
    bytes.push(0x2c);
    u16(f.left ?? 0);
    u16(f.top ?? 0);
    u16(f.width);
    u16(f.height);
    const local = f.localPalette ? colourTable(f.localPalette) : undefined;
    bytes.push((local ? local.flags : 0) | (f.interlaced ? 0x40 : 0));
    if (local) bytes.push(...local.bytes);
    const paletteSize = (f.localPalette ?? spec.palette ?? []).length;
    const minCodeSize = Math.max(2, tableBits(paletteSize));
    const order: number[] = [];
    if (f.interlaced) {
      for (const [start, step] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ] as const)
        for (let y = start; y < f.height; y += step) order.push(y);
    } else {
      for (let y = 0; y < f.height; y++) order.push(y);
    }
    const indices: number[] = [];
    for (const y of order) for (let x = 0; x < f.width; x++) indices.push(f.index(x, y));
    const data = lzwEncode(indices, minCodeSize);
    bytes.push(minCodeSize);
    for (let at = 0; at < data.length; at += 255) {
      const block = data.subarray(at, at + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}

// ---------- BMP ----------

export interface BmpSpec {
  width: number;
  height: number;
  bpp: 1 | 4 | 8 | 16 | 24 | 32;
  /** Pixel value: palette index (≤ 8 bits), packed 16/32-bit value, or 0xRRGGBB for 24-bit. */
  pixel: (x: number, y: number) => number;
  palette?: Array<[number, number, number]>;
  topDown?: boolean;
  /** DIB header size: 12 (core), 40 (info), 108 (v4) or 124 (v5). */
  header?: 12 | 40 | 108 | 124;
  /** Bit-field masks [r, g, b, a?]: written as BI_BITFIELDS (or BI_ALPHABITFIELDS with a 40-byte header and 4 masks). */
  masks?: number[];
}

export function writeBmp(spec: BmpSpec): Uint8Array {
  const { width, height, bpp } = spec;
  const header = spec.header ?? 40;
  const masks = spec.masks;
  const extraMasks = header === 40 && masks ? masks.length * 4 : 0;
  const paletteEntry = header === 12 ? 3 : 4;
  const palette = bpp <= 8 ? (spec.palette ?? []) : [];
  const dataStart = 14 + header + extraMasks + palette.length * paletteEntry;
  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  const size = dataStart + stride * height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  view.setUint32(2, size, true);
  view.setUint32(10, dataStart, true);
  view.setUint32(14, header, true);
  if (header === 12) {
    view.setUint16(18, width, true);
    view.setUint16(20, height, true);
    view.setUint16(22, 1, true);
    view.setUint16(24, bpp, true);
  } else {
    view.setInt32(18, width, true);
    view.setInt32(22, spec.topDown ? -height : height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, bpp, true);
    const compression = masks ? (header === 40 && masks.length === 4 ? 6 : 3) : 0;
    view.setUint32(30, compression, true);
    view.setUint32(34, stride * height, true);
    view.setUint32(46, palette.length, true);
    if (masks && header === 40) masks.forEach((m, i) => view.setUint32(54 + i * 4, m, true));
    if (masks && header > 40) masks.forEach((m, i) => view.setUint32(54 + i * 4, m, true));
  }
  palette.forEach(([r, g, b], i) => {
    const p = 14 + header + extraMasks + i * paletteEntry;
    out.set([b, g, r], p);
  });
  for (let y = 0; y < height; y++) {
    const row = dataStart + (spec.topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const v = spec.pixel(x, y);
      if (bpp < 8) {
        const bit = x * bpp;
        out[row + (bit >> 3)]! |= v << (8 - bpp - (bit & 7));
      } else if (bpp === 8) out[row + x] = v;
      else if (bpp === 16) view.setUint16(row + x * 2, v, true);
      else if (bpp === 24) out.set([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff], row + x * 3);
      else view.setUint32(row + x * 4, v >>> 0, true);
    }
  }
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
