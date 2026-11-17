// GIF decoder in plain TypeScript (first frame only), for workers without OffscreenCanvas.
// Like browsers: the first frame is drawn at its offset on a transparent canvas of the logical
// screen size (the background colour is ignored), its transparent index stays transparent,
// interlaced frames are de-interlaced, and a frame that stops early leaves the rest transparent.

import { checkDimensions, PixelDecodeError, type RawImage } from './raw';

const MAX_CODE = 4096;

function u16(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}

/** Decodes the first frame of a GIF to straight RGBA. Throws {@link PixelDecodeError}. */
export function decodeGif(bytes: Uint8Array, maxPixels: number): RawImage {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new PixelDecodeError('not a GIF');
  if (bytes.length < 13) throw new PixelDecodeError('truncated header');
  let screenW = u16(bytes, 6);
  let screenH = u16(bytes, 8);
  const flags = bytes[10]!;
  let at = 13;
  let globalTable: Uint8Array | undefined;
  if (flags & 0x80) {
    const size = 3 << ((flags & 7) + 1);
    if (at + size > bytes.length) throw new PixelDecodeError('truncated colour table');
    globalTable = bytes.subarray(at, at + size);
    at += size;
  }

  let transparent = -1;
  while (at < bytes.length) {
    const block = bytes[at++]!;
    if (block === 0x21) {
      const label = bytes[at++];
      if (label === undefined) break;
      if (label === 0xf9 && bytes[at] === 4 && at + 5 <= bytes.length) {
        transparent = bytes[at + 1]! & 1 ? bytes[at + 4]! : -1;
      }
      at = skipSubBlocks(bytes, at);
    } else if (block === 0x2c) {
      if (at + 9 > bytes.length) throw new PixelDecodeError('truncated image descriptor');
      const left = u16(bytes, at);
      const top = u16(bytes, at + 2);
      const fw = u16(bytes, at + 4);
      const fh = u16(bytes, at + 6);
      const frameFlags = bytes[at + 8]!;
      at += 9;
      let table = globalTable;
      if (frameFlags & 0x80) {
        const size = 3 << ((frameFlags & 7) + 1);
        if (at + size > bytes.length) throw new PixelDecodeError('truncated local colour table');
        table = bytes.subarray(at, at + size);
        at += size;
      }
      if (!table) throw new PixelDecodeError('no colour table');
      // A zero logical screen (seen in broken files) takes the first frame's extent.
      if (screenW === 0 || screenH === 0) {
        screenW = left + fw;
        screenH = top + fh;
      }
      checkDimensions(screenW, screenH, maxPixels);
      if (fw * fh > maxPixels) throw new PixelDecodeError('frame too large', true);
      const minCodeSize = bytes[at++];
      if (minCodeSize === undefined || minCodeSize < 1 || minCodeSize > 11) {
        throw new PixelDecodeError('bad LZW code size');
      }
      const data = collectSubBlocks(bytes, at);
      const indices = lzw(data, minCodeSize, fw * fh);
      return compose(screenW, screenH, { left, top, fw, fh }, indices, table, transparent, {
        interlaced: (frameFlags & 0x40) !== 0,
      });
    } else if (block === 0x3b) {
      break;
    } else {
      throw new PixelDecodeError(`unknown block 0x${block.toString(16)}`);
    }
  }
  throw new PixelDecodeError('no image in the file');
}

function skipSubBlocks(b: Uint8Array, from: number): number {
  let at = from;
  while (at < b.length) {
    const n = b[at]!;
    at += 1 + n;
    if (n === 0) return at;
  }
  return b.length;
}

function collectSubBlocks(b: Uint8Array, from: number): Uint8Array {
  let total = 0;
  let at = from;
  while (at < b.length && b[at] !== 0) {
    total += Math.min(b[at]!, b.length - at - 1);
    at += 1 + b[at]!;
  }
  const out = new Uint8Array(total);
  let o = 0;
  at = from;
  while (at < b.length && b[at] !== 0) {
    const n = Math.min(b[at]!, b.length - at - 1);
    out.set(b.subarray(at + 1, at + 1 + n), o);
    o += n;
    at += 1 + b[at]!;
  }
  return out;
}

/**
 * LZW-decodes up to `count` palette indices. Stops at the end code, at the end of the data, or at
 * an invalid code; indices not reached are reported by `filled` (the rest of the array is unused).
 */
function lzw(data: Uint8Array, minCodeSize: number, count: number): { out: Uint8Array; filled: number } {
  const out = new Uint8Array(count);
  const prefix = new Uint16Array(MAX_CODE);
  const suffix = new Uint8Array(MAX_CODE);
  const stack = new Uint8Array(MAX_CODE + 1);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  for (let i = 0; i < clear; i++) suffix[i] = i;

  let size = minCodeSize + 1;
  let mask = (1 << size) - 1;
  let next = clear + 2;
  let prev = -1;
  let first = 0;
  let bits = 0;
  let acc = 0;
  let pos = 0;
  let o = 0;

  while (o < count) {
    while (bits < size && pos < data.length) {
      acc |= data[pos++]! << bits;
      bits += 8;
    }
    if (bits < size) break; // out of data
    let code = acc & mask;
    acc >>>= size;
    bits -= size;

    if (code === clear) {
      size = minCodeSize + 1;
      mask = (1 << size) - 1;
      next = clear + 2;
      prev = -1;
      continue;
    }
    if (code === end) break;
    if (prev === -1) {
      if (code >= clear) break; // must start with a literal
      out[o++] = code;
      first = code;
      prev = code;
      continue;
    }
    const inCode = code;
    let sp = 0;
    if (code >= next) {
      if (code > next) break; // corrupt
      stack[sp++] = first;
      code = prev;
    }
    while (code >= clear) {
      stack[sp++] = suffix[code]!;
      code = prefix[code]!;
    }
    first = code;
    stack[sp++] = first;
    while (sp > 0 && o < count) out[o++] = stack[--sp]!;
    if (next < MAX_CODE) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if (next > mask && size < 12) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    prev = inCode;
  }
  return { out, filled: o };
}

interface Frame {
  left: number;
  top: number;
  fw: number;
  fh: number;
}

function compose(
  width: number,
  height: number,
  f: Frame,
  { out: indices, filled }: { out: Uint8Array; filled: number },
  table: Uint8Array,
  transparent: number,
  { interlaced }: { interlaced: boolean },
): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const entries = table.length / 3;
  const rowOrder = interlaced ? interlacedRows(f.fh) : undefined;
  for (let i = 0; i < filled; i++) {
    const idx = indices[i]!;
    if (idx === transparent) continue;
    const fy = Math.floor(i / f.fw);
    const y = f.top + (rowOrder ? rowOrder[fy]! : fy);
    const x = f.left + (i - fy * f.fw);
    if (x >= width || y >= height) continue;
    const o = (y * width + x) * 4;
    if (idx < entries) {
      data[o] = table[idx * 3]!;
      data[o + 1] = table[idx * 3 + 1]!;
      data[o + 2] = table[idx * 3 + 2]!;
    }
    data[o + 3] = 255;
  }
  return { width, height, data };
}

/** For each row in file order, the image row it belongs to (passes: every 8th from 0, 8th from 4, 4th from 2, 2nd from 1). */
function interlacedRows(h: number): Uint32Array {
  const rows = new Uint32Array(h);
  let i = 0;
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const) {
    for (let y = start; y < h; y += step) rows[i++] = y;
  }
  return rows;
}
