// BMP decoder in plain TypeScript, for workers without OffscreenCanvas.
// Uncompressed 1/4/8-bit palette, 16-bit (5-5-5 or bit fields), 24-bit and 32-bit (BGRA or bit
// fields); bottom-up and top-down. Matches Chromium pixel for pixel (fallback.browser.test.ts):
// 32-bit BI_RGB has no alpha, bit-field alpha that is zero everywhere means opaque, and channels
// narrower than 8 bits are scaled with rounding. RLE and embedded JPEG/PNG BMPs are refused.

import { checkDimensions, PixelDecodeError, type RawImage } from './raw';

const BI_RGB = 0;
const BI_BITFIELDS = 3;
const BI_ALPHABITFIELDS = 6;

function u16(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}
function u32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

interface Channel {
  mask: number;
  shift: number;
  bits: number;
}

function channel(mask: number): Channel {
  if (mask === 0) return { mask: 0, shift: 0, bits: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (shift + bits < 32 && ((mask >>> (shift + bits)) & 1) === 1) bits++;
  return { mask, shift, bits };
}

/** Value of a masked channel as 8 bits: wider channels keep their top 8 bits, narrower ones are scaled. */
function widen(px: number, c: Channel): number {
  const v = (px & c.mask) >>> c.shift;
  if (c.bits >= 8) return (v >>> (c.bits - 8)) & 0xff;
  return Math.round((v * 255) / ((1 << c.bits) - 1));
}

/** Decodes a BMP file to straight RGBA. Throws {@link PixelDecodeError}. */
export function decodeBmp(bytes: Uint8Array, maxPixels: number): RawImage {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new PixelDecodeError('not a BMP');
  }
  const dataStart = u32(bytes, 10);
  const dib = u32(bytes, 14);
  let width: number;
  let rawHeight: number;
  let bpp: number;
  let compression = BI_RGB;
  let colours = 0;
  let paletteEntrySize = 4;
  const masks = [0, 0, 0, 0];

  if (dib === 12) {
    width = u16(bytes, 18);
    rawHeight = u16(bytes, 20);
    bpp = u16(bytes, 24);
    paletteEntrySize = 3;
  } else if (dib >= 40 && dib <= 124 && bytes.length >= 14 + 40) {
    width = u32(bytes, 18) | 0;
    rawHeight = u32(bytes, 22) | 0;
    bpp = u16(bytes, 28);
    compression = u32(bytes, 30);
    colours = u32(bytes, 46);
    // Version 2+ headers carry the masks (OS/2's 64-byte header has other fields there).
    if (dib >= 52 && dib !== 64 && bytes.length >= 14 + 52) {
      masks[0] = u32(bytes, 54);
      masks[1] = u32(bytes, 58);
      masks[2] = u32(bytes, 62);
    }
    if (dib >= 56 && dib !== 64 && bytes.length >= 14 + 56) masks[3] = u32(bytes, 66);
  } else {
    throw new PixelDecodeError(`unsupported header size ${dib}`);
  }

  let paletteStart = 14 + dib;
  if (dib === 40 && (compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS)) {
    // Masks follow the 40-byte header.
    const n = compression === BI_ALPHABITFIELDS ? 4 : 3;
    if (paletteStart + 4 * n > bytes.length) throw new PixelDecodeError('truncated bit fields');
    for (let i = 0; i < n; i++) masks[i] = u32(bytes, paletteStart + 4 * i);
    paletteStart += 4 * n;
  }

  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  checkDimensions(width, height, maxPixels);

  const fields = compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS;
  if (compression !== BI_RGB && !(fields && (bpp === 16 || bpp === 32))) {
    throw new PixelDecodeError(`unsupported compression ${compression} at ${bpp} bits`);
  }
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new PixelDecodeError(`unsupported depth ${bpp}`);

  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  if (dataStart > bytes.length || stride * height > bytes.length - dataStart) {
    throw new PixelDecodeError('pixel data is truncated');
  }
  const data = new Uint8ClampedArray(width * height * 4);
  const rowAt = (y: number) => dataStart + (topDown ? y : height - 1 - y) * stride;

  if (bpp <= 8) {
    const count = colours > 0 ? Math.min(colours, 1 << bpp) : 1 << bpp;
    const lut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) lut[i * 4 + 3] = 255; // missing entries: opaque black
    for (let i = 0; i < count; i++) {
      const p = paletteStart + i * paletteEntrySize;
      if (p + 3 > dataStart || p + 3 > bytes.length) break;
      lut[i * 4] = bytes[p + 2]!;
      lut[i * 4 + 1] = bytes[p + 1]!;
      lut[i * 4 + 2] = bytes[p]!;
    }
    const perByte = 8 / bpp;
    const max = (1 << bpp) - 1;
    for (let y = 0; y < height; y++) {
      const row = rowAt(y);
      let o = y * width * 4;
      for (let x = 0; x < width; x++, o += 4) {
        const byte = bytes[row + Math.floor(x / perByte)]!;
        const shift = 8 - bpp * ((x % perByte) + 1);
        const idx = ((byte >> shift) & max) * 4;
        data[o] = lut[idx]!;
        data[o + 1] = lut[idx + 1]!;
        data[o + 2] = lut[idx + 2]!;
        data[o + 3] = 255;
      }
    }
    return { width, height, data };
  }

  if (bpp === 24) {
    for (let y = 0; y < height; y++) {
      let s = rowAt(y);
      let o = y * width * 4;
      for (let x = 0; x < width; x++, s += 3, o += 4) {
        data[o] = bytes[s + 2]!;
        data[o + 1] = bytes[s + 1]!;
        data[o + 2] = bytes[s]!;
        data[o + 3] = 255;
      }
    }
    return { width, height, data };
  }

  // 16 and 32 bits: channel masks. BI_RGB has fixed ones and no alpha (Chromium ignores the
  // fourth byte of a 32-bit BI_RGB pixel, whatever the header version).
  if (!fields) {
    if (bpp === 16) masks.splice(0, 4, 0x7c00, 0x03e0, 0x001f, 0);
    else masks.splice(0, 4, 0x00ff0000, 0x0000ff00, 0x000000ff, 0);
  }
  const [r, g, b, a] = masks.map(channel) as [Channel, Channel, Channel, Channel];
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    let s = rowAt(y);
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      let px: number;
      if (bpp === 16) {
        px = u16(bytes, s);
        s += 2;
      } else {
        px = u32(bytes, s);
        s += 4;
      }
      data[o] = widen(px, r);
      data[o + 1] = widen(px, g);
      data[o + 2] = widen(px, b);
      if (a.bits > 0) {
        const av = widen(px, a);
        data[o + 3] = av;
        if (av !== 0) anyAlpha = true;
      }
    }
  }
  if (!anyAlpha) for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}
