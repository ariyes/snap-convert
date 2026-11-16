// EXIF orientation: turning stored pixels upright, and finding out whether the browser
// already did it (createImageBitmap with imageOrientation 'from-image' rotates in some
// browsers and for some formats only), so pixels are rotated exactly once.

import type { IsoTransform } from './container';

/** True for orientations that swap width and height (5–8). */
export function swapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Returns upright pixels for an EXIF orientation (1–8). Pure pixel moves, no resampling.
 * Orientation 1 (or an unknown value) returns the input unchanged.
 */
export function orientPixels(img: ImageData, orientation: number): ImageData {
  if (orientation < 2 || orientation > 8) return img;
  const sw = img.width;
  const sh = img.height;
  const swap = swapsAxes(orientation);
  const dw = swap ? sh : sw;
  const dh = swap ? sw : sh;
  const src = new Uint32Array(img.data.buffer, img.data.byteOffset, sw * sh);
  const out = new ImageData(dw, dh);
  const dst = new Uint32Array(out.data.buffer);
  // For each upright (display) pixel (x, y), the stored pixel it comes from.
  const from: (x: number, y: number) => number = {
    2: (x: number, y: number) => y * sw + (sw - 1 - x),
    3: (x: number, y: number) => (sh - 1 - y) * sw + (sw - 1 - x),
    4: (x: number, y: number) => (sh - 1 - y) * sw + x,
    5: (x: number, y: number) => x * sw + y,
    6: (x: number, y: number) => (sh - 1 - x) * sw + y,
    7: (x: number, y: number) => (sh - 1 - x) * sw + (sw - 1 - y),
    8: (x: number, y: number) => x * sw + (sw - 1 - y),
  }[orientation as 2 | 3 | 4 | 5 | 6 | 7 | 8];
  let i = 0;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) dst[i++] = src[from(x, y)] ?? 0;
  }
  return out;
}

/** Applies HEIF/AVIF container transforms (irot / imir) in order. Used when we decode AVIF ourselves. */
export function applyIsoTransforms(
  img: ImageData,
  transforms: readonly IsoTransform[] | undefined,
): ImageData {
  let out = img;
  for (const t of transforms ?? []) {
    if ('rotate' in t) {
      // Anti-clockwise 90 = EXIF 8, 180 = EXIF 3, 270 = EXIF 6.
      out = orientPixels(out, t.rotate === 90 ? 8 : t.rotate === 180 ? 3 : 6);
    } else {
      out = orientPixels(out, t.mirror === 'vertical-axis' ? 2 : 4);
    }
  }
  return out;
}

// ---------- Does the browser apply EXIF orientation itself? ----------

/** Smallest valid big-endian TIFF/EXIF block with Orientation = 6 (rotate 90° clockwise). */
const ORIENTATION_6_EXIF = new Uint8Array([
  0x4d,
  0x4d,
  0x00,
  0x2a,
  0x00,
  0x00,
  0x00,
  0x08, // header, IFD0 at 8
  0x00,
  0x01, // one entry
  0x01,
  0x12,
  0x00,
  0x03,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x06,
  0x00,
  0x00, // Orientation SHORT 6
  0x00,
  0x00,
  0x00,
  0x00, // no next IFD
]);

type ProbeFormat = 'jpeg' | 'png' | 'webp';
const probes = new Map<ProbeFormat, Promise<boolean | undefined>>();

/**
 * Whether createImageBitmap(…, { imageOrientation: 'from-image' }) applies EXIF orientation
 * for this format in this browser. Tested once with a tiny 2×1 image tagged "rotate 90°":
 * the browser rotated it if the bitmap comes back 1×2. `undefined` if the test couldn't run.
 */
export function browserAppliesOrientation(format: ProbeFormat): Promise<boolean | undefined> {
  let probe = probes.get(format);
  if (!probe) {
    probe = runProbe(format).catch(() => undefined);
    probes.set(format, probe);
  }
  return probe;
}

async function runProbe(format: ProbeFormat): Promise<boolean | undefined> {
  const canvas = new OffscreenCanvas(2, 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#f00';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = '#00f';
  ctx.fillRect(1, 0, 1, 1);
  const encoded = await canvas.convertToBlob({ type: `image/${format}` });
  if (encoded.type !== `image/${format}`) return undefined; // this browser can't encode it (e.g. WebP in Safari)
  const plain = new Uint8Array(await encoded.arrayBuffer());
  const tagged =
    format === 'jpeg' ? tagJpeg(plain) : format === 'png' ? tagPng(plain) : tagWebp(plain);
  if (!tagged) return undefined;
  const bitmap = await createImageBitmap(new Blob([tagged as Uint8Array<ArrayBuffer>]), {
    imageOrientation: 'from-image',
  });
  const rotated = bitmap.width === 1 && bitmap.height === 2;
  bitmap.close();
  return rotated;
}

function tagJpeg(jpeg: Uint8Array): Uint8Array {
  const payload = new Uint8Array(6 + ORIENTATION_6_EXIF.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]); // "Exif\0\0"
  payload.set(ORIENTATION_6_EXIF, 6);
  const len = payload.length + 2;
  return join(
    jpeg.subarray(0, 2),
    new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff]),
    payload,
    jpeg.subarray(2),
  );
}

function tagPng(png: Uint8Array): Uint8Array {
  const ihdrEnd = 8 + 12 + 13;
  return join(
    png.subarray(0, ihdrEnd),
    pngChunk('eXIf', ORIENTATION_6_EXIF),
    png.subarray(ihdrEnd),
  );
}

function tagWebp(webp: Uint8Array): Uint8Array | undefined {
  const body = webp.subarray(12);
  const first = String.fromCharCode(...body.subarray(0, 4));
  if (first !== 'VP8 ' && first !== 'VP8L') return undefined; // only simple files can be wrapped here
  const vp8x = new Uint8Array(18);
  vp8x.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0]); // "VP8X", size 10
  vp8x[8] = 0x08; // EXIF flag
  // canvas width - 1 and height - 1, 24-bit little-endian: 2×1
  vp8x.set([1, 0, 0, 0, 0, 0], 12);
  const exifChunk = new Uint8Array(8 + ORIENTATION_6_EXIF.length);
  exifChunk.set([0x45, 0x58, 0x49, 0x46]); // "EXIF"
  setU32LE(exifChunk, 4, ORIENTATION_6_EXIF.length);
  exifChunk.set(ORIENTATION_6_EXIF, 8);
  const riffHeader = new Uint8Array(12);
  riffHeader.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); // "RIFF" … "WEBP"
  setU32LE(riffHeader, 4, 4 + vp8x.length + body.length + exifChunk.length);
  return join(riffHeader, vp8x, body, exifChunk);
}

function setU32LE(b: Uint8Array, at: number, v: number): void {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
  b[at + 2] = (v >>> 16) & 0xff;
  b[at + 3] = (v >>> 24) & 0xff;
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
