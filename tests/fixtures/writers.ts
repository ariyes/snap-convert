// Tiny file writers used only to generate test fixtures (EXIF blocks, GIF, BMP, JPEG/PNG splicing).

/** Upright test card: red top-left, green top-right, blue bottom-left, yellow bottom-right. */
export const QUADRANT_COLOURS = {
  topLeft: [255, 0, 0],
  topRight: [0, 255, 0],
  bottomLeft: [0, 0, 255],
  bottomRight: [255, 255, 0],
} as const;

export type ExifValue =
  | { type: 'ascii'; value: string }
  | { type: 'short'; value: number }
  | { type: 'long'; value: number }
  | { type: 'rational'; value: Array<[number, number]> };

export interface ExifSpec {
  ifd0?: Record<number, ExifValue>;
  exif?: Record<number, ExifValue>;
  gps?: Record<number, ExifValue>;
}

export const TAG = {
  Make: 0x010f,
  Model: 0x0110,
  Orientation: 0x0112,
  DateTime: 0x0132,
  ExifIFD: 0x8769,
  GPSIFD: 0x8825,
  DateTimeOriginal: 0x9003,
  OffsetTimeOriginal: 0x9011,
  GPSLatitudeRef: 0x0001,
  GPSLatitude: 0x0002,
  GPSLongitudeRef: 0x0003,
  GPSLongitude: 0x0004,
} as const;

/** Writes a little-endian TIFF/EXIF block (IFD0 + optional EXIF and GPS sub-IFDs). */
export function writeExif(spec: ExifSpec): Uint8Array {
  const buf = new Uint8Array(4096);
  const view = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 0x2a, 0x00]); // "II*\0"
  view.setUint32(4, 8, true);
  let end = 8;

  const typeCode = { ascii: 2, short: 3, long: 4, rational: 5 } as const;
  const encode = (v: ExifValue): { count: number; bytes: Uint8Array } => {
    switch (v.type) {
      case 'ascii': {
        const bytes = new Uint8Array(v.value.length + 1);
        for (let i = 0; i < v.value.length; i++) bytes[i] = v.value.charCodeAt(i);
        return { count: bytes.length, bytes };
      }
      case 'short': {
        const bytes = new Uint8Array(2);
        new DataView(bytes.buffer).setUint16(0, v.value, true);
        return { count: 1, bytes };
      }
      case 'long': {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, v.value, true);
        return { count: 1, bytes };
      }
      case 'rational': {
        const bytes = new Uint8Array(8 * v.value.length);
        const dv = new DataView(bytes.buffer);
        v.value.forEach(([n, d], i) => {
          dv.setUint32(i * 8, n, true);
          dv.setUint32(i * 8 + 4, d, true);
        });
        return { count: v.value.length, bytes };
      }
    }
  };

  // Writes one IFD at `end`; returns the offsets of LONG entries whose value must be patched later.
  const writeIfd = (entries: Record<number, ExifValue>): Map<number, number> => {
    const tags = Object.keys(entries)
      .map(Number)
      .sort((a, b) => a - b);
    const start = end;
    view.setUint16(start, tags.length, true);
    let dataAt = start + 2 + tags.length * 12 + 4;
    const patches = new Map<number, number>();
    tags.forEach((tag, i) => {
      const entry = start + 2 + i * 12;
      const v = entries[tag];
      if (!v) return;
      const { count, bytes } = encode(v);
      view.setUint16(entry, tag, true);
      view.setUint16(entry + 2, typeCode[v.type], true);
      view.setUint32(entry + 4, count, true);
      if (bytes.length <= 4) {
        buf.set(bytes, entry + 8);
        patches.set(tag, entry + 8);
      } else {
        view.setUint32(entry + 8, dataAt, true);
        buf.set(bytes, dataAt);
        dataAt += bytes.length + (bytes.length % 2);
      }
    });
    view.setUint32(start + 2 + tags.length * 12, 0, true); // no next IFD
    end = dataAt;
    return patches;
  };

  const ifd0 = { ...spec.ifd0 };
  if (spec.exif) ifd0[TAG.ExifIFD] = { type: 'long', value: 0 };
  if (spec.gps) ifd0[TAG.GPSIFD] = { type: 'long', value: 0 };
  const patches = writeIfd(ifd0);
  if (spec.exif) {
    view.setUint32(patches.get(TAG.ExifIFD) ?? 0, end, true);
    writeIfd(spec.exif);
  }
  if (spec.gps) {
    view.setUint32(patches.get(TAG.GPSIFD) ?? 0, end, true);
    writeIfd(spec.gps);
  }
  return buf.slice(0, end);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Inserts an APP1 "Exif" segment right after the JPEG SOI marker. */
export function jpegWithExif(jpeg: Uint8Array, exif: Uint8Array): Uint8Array {
  const len = 2 + 6 + exif.length;
  const header = new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  return concatBytes(jpeg.subarray(0, 2), header, exif, jpeg.subarray(2));
}

/** 24-bit bottom-up BMP (rows padded to 4 bytes). */
export function writeBmp(img: ImageData): Uint8Array {
  const rowSize = Math.ceil((img.width * 3) / 4) * 4;
  const size = 54 + rowSize * img.height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, img.width, true);
  view.setInt32(22, img.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, rowSize * img.height, true);
  for (let y = 0; y < img.height; y++) {
    const row = 54 + (img.height - 1 - y) * rowSize;
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      out[row + x * 3] = img.data[s + 2] ?? 0;
      out[row + x * 3 + 1] = img.data[s + 1] ?? 0;
      out[row + x * 3 + 2] = img.data[s] ?? 0;
    }
  }
  return out;
}

/**
 * GIF with one frame per palette-index array (all frames full size). Uses 8-bit LZW codes with a
 * clear code every 100 pixels, so no dictionary is needed — valid, just not compressed much.
 */
export function writeGif(
  width: number,
  height: number,
  palette: Array<[number, number, number]>,
  frames: Uint8Array[],
): Uint8Array {
  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 0xff, v >> 8);
  for (const c of 'GIF89a') bytes.push(c.charCodeAt(0));
  u16(width);
  u16(height);
  bytes.push(0xf6, 0, 0); // global colour table, 128 entries (2^(6+1))
  for (let i = 0; i < 128; i++) bytes.push(...(palette[i] ?? [0, 0, 0]));
  bytes.push(0x21, 0xff, 11, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0); // loop
  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 4, 0, 50, 0, 0, 0); // graphic control: 0.5 s
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    bytes.push(0);
    bytes.push(7); // LZW minimum code size → 8-bit codes; clear = 128, end = 129
    const codes: number[] = [];
    frame.forEach((index, i) => {
      if (i % 100 === 0) codes.push(128);
      codes.push(index);
    });
    codes.push(129);
    for (let at = 0; at < codes.length; at += 255) {
      const block = codes.slice(at, at + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}
