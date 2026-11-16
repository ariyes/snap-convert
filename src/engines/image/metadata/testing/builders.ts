/**
 * Builders for metadata tests (P06): hand-made EXIF (TIFF) blocks, ICC profiles and JPEG
 * header structures with known contents. Test-only; nothing in the app imports this file.
 */
import { MARKER, type JpegSegment, SIGNATURE, writeJpeg } from '../jpeg-segments';

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

type Value =
  | { short: number }
  | { long: number }
  | { ascii: string }
  | { rationals: Array<[number, number]> }
  | { pointer: true };

interface EntrySpec {
  tag: number;
  value: Value;
}

class TiffWriter {
  readonly bytes = new Uint8Array(16384);
  readonly view = new DataView(this.bytes.buffer);
  pos = 8;
  constructor(readonly little: boolean) {
    this.bytes[0] = this.bytes[1] = little ? 0x49 : 0x4d;
    this.view.setUint16(2, 42, little);
    this.view.setUint32(4, 8, little); // IFD0 follows the header
  }
  u16(at: number, v: number) {
    this.view.setUint16(at, v, this.little);
  }
  u32(at: number, v: number) {
    this.view.setUint32(at, v, this.little);
  }
  /** Writes an IFD at the current position; returns where its pointer fields and next link are. */
  ifd(entries: EntrySpec[]): { at: number; pointers: Map<number, number>; nextAt: number } {
    const at = this.pos;
    const sorted = [...entries].sort((a, b) => a.tag - b.tag);
    this.u16(at, sorted.length);
    const nextAt = at + 2 + sorted.length * 12;
    this.pos = nextAt + 4;
    const pointers = new Map<number, number>();
    sorted.forEach((e, i) => {
      const o = at + 2 + i * 12;
      this.u16(o, e.tag);
      const v = e.value;
      if ('short' in v) {
        this.u16(o + 2, SHORT);
        this.u32(o + 4, 1);
        this.u16(o + 8, v.short);
      } else if ('long' in v) {
        this.u16(o + 2, LONG);
        this.u32(o + 4, 1);
        this.u32(o + 8, v.long);
      } else if ('pointer' in v) {
        this.u16(o + 2, LONG);
        this.u32(o + 4, 1);
        pointers.set(e.tag, o + 8);
      } else if ('ascii' in v) {
        const s = v.ascii + '\0';
        this.u16(o + 2, ASCII);
        this.u32(o + 4, s.length);
        const target = s.length <= 4 ? o + 8 : this.alloc(s.length);
        if (s.length > 4) this.u32(o + 8, target);
        for (let k = 0; k < s.length; k++) this.bytes[target + k] = s.charCodeAt(k);
      } else {
        this.u16(o + 2, RATIONAL);
        this.u32(o + 4, v.rationals.length);
        const target = this.alloc(v.rationals.length * 8);
        this.u32(o + 8, target);
        v.rationals.forEach(([n, d], k) => {
          this.u32(target + k * 8, n);
          this.u32(target + k * 8 + 4, d);
        });
      }
    });
    return { at, pointers, nextAt };
  }
  alloc(size: number): number {
    const at = this.pos;
    this.pos += size + (size % 2); // keep word alignment
    return at;
  }
  done(): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(0, this.pos);
  }
}

export const GPS_LATITUDE: Array<[number, number]> = [
  [51, 1],
  [30, 1],
  [2649, 100],
];
export const THUMBNAIL_FILL = 0xab;

export interface ExifSpec {
  littleEndian?: boolean;
  orientation?: number;
  gps?: boolean;
  thumbnail?: boolean;
}

/** A realistic EXIF TIFF block: Make/Model, orientation, Exif IFD with date, GPS IFD, IFD1 thumbnail. */
export function buildExifTiff(o: ExifSpec = {}): Uint8Array<ArrayBuffer> {
  const w = new TiffWriter(o.littleEndian ?? true);
  const ifd0: EntrySpec[] = [
    { tag: 0x010f, value: { ascii: 'TestCam Industries' } },
    { tag: 0x0110, value: { ascii: 'Model X100' } },
    { tag: 0x8769, value: { pointer: true } },
  ];
  if (o.orientation !== undefined) ifd0.push({ tag: 0x0112, value: { short: o.orientation } });
  if (o.gps) ifd0.push({ tag: 0x8825, value: { pointer: true } });
  const root = w.ifd(ifd0);

  const exifAt = w.pos;
  w.u32(root.pointers.get(0x8769)!, exifAt);
  w.ifd([
    { tag: 0x9003, value: { ascii: '2026:11:16 10:20:30' } },
    { tag: 0xa431, value: { ascii: 'SERIAL-12345' } },
  ]);

  if (o.gps) {
    const gpsAt = w.pos;
    w.u32(root.pointers.get(0x8825)!, gpsAt);
    w.ifd([
      { tag: 0x0001, value: { ascii: 'N' } },
      { tag: 0x0002, value: { rationals: GPS_LATITUDE } },
      { tag: 0x0003, value: { ascii: 'W' } },
      {
        tag: 0x0004,
        value: {
          rationals: [
            [0, 1],
            [7, 1],
            [3999, 100],
          ],
        },
      },
    ]);
  }

  if (o.thumbnail) {
    const ifd1At = w.pos;
    w.u32(root.nextAt, ifd1At);
    const ifd1 = w.ifd([
      { tag: 0x0103, value: { short: 6 } },
      { tag: 0x0112, value: { short: o.orientation ?? 1 } },
      { tag: 0x0201, value: { pointer: true } },
      { tag: 0x0202, value: { long: 64 } },
    ]);
    const thumbAt = w.alloc(64);
    w.u32(ifd1.pointers.get(0x0201)!, thumbAt);
    w.bytes.fill(THUMBNAIL_FILL, thumbAt, thumbAt + 64);
  }
  return w.done();
}

export function ascii(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const exifSegment = (tiff: Uint8Array): JpegSegment => ({
  marker: MARKER.APP1,
  data: concat(ascii(SIGNATURE.exif), tiff),
});
export const xmpSegment = (): JpegSegment => ({
  marker: MARKER.APP1,
  data: ascii(`${SIGNATURE.xmp}<x:xmpmeta><exif:GPSLatitude>51,30N</exif:GPSLatitude></x:xmpmeta>`),
});
export const commentSegment = (text: string): JpegSegment => ({
  marker: MARKER.COM,
  data: ascii(text),
});

/**
 * A structurally valid baseline JPEG skeleton (JFIF, DQT, SOF0 3×8-bit 4:2:0, DHT, SOS, scan
 * bytes, EOI). Not decodable as a picture — the segment parser doesn't need it to be.
 */
export function buildJpeg(extra: JpegSegment[] = [], seed = 1): Uint8Array<ArrayBuffer> {
  const jfif: JpegSegment = {
    marker: MARKER.APP0,
    data: concat(ascii(SIGNATURE.jfif), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0])),
  };
  const dqt: JpegSegment = { marker: 0xdb, data: new Uint8Array(65).fill(16) };
  dqt.data[0] = 0;
  const sof: JpegSegment = {
    marker: 0xc0,
    data: new Uint8Array([8, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  };
  const dht: JpegSegment = { marker: 0xc4, data: new Uint8Array(29) };
  dht.data[1] = 1; // one code of length 1
  // SOS header followed by pseudo-random entropy data (0xFF stuffed as FF 00) and EOI.
  let s = seed >>> 0;
  const scanBytes: number[] = [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  for (let i = 0; i < 400; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const b = s >>> 24;
    scanBytes.push(b);
    if (b === 0xff) scanBytes.push(0);
  }
  scanBytes.push(0xff, 0xd9);
  return writeJpeg([jfif, ...extra, dqt, sof, dht], new Uint8Array(scanBytes));
}

/** Minimal ICC profile header + tag table with a 'desc' tag (v2 'desc' or v4 'mluc' type). */
export function buildIcc(
  description: string,
  version: 2 | 4 = 2,
  colourSpace = 'RGB ',
): Uint8Array<ArrayBuffer> {
  const desc =
    version === 2
      ? (() => {
          const d = new Uint8Array(12 + description.length + 1 + 79);
          d.set(ascii('desc'), 0);
          new DataView(d.buffer).setUint32(8, description.length + 1);
          d.set(ascii(description), 12);
          return d;
        })()
      : (() => {
          const d = new Uint8Array(28 + description.length * 2);
          const v = new DataView(d.buffer);
          d.set(ascii('mluc'), 0);
          v.setUint32(8, 1);
          v.setUint32(12, 12);
          d.set(ascii('enUS'), 16);
          v.setUint32(20, description.length * 2);
          v.setUint32(24, 28);
          for (let i = 0; i < description.length; i++)
            v.setUint16(28 + i * 2, description.charCodeAt(i));
          return d;
        })();
  const size = 132 + 12 + desc.length;
  const icc = new Uint8Array(size);
  const v = new DataView(icc.buffer);
  v.setUint32(0, size);
  icc[8] = version;
  icc.set(ascii('mntr'), 12);
  icc.set(ascii(colourSpace), 16);
  icc.set(ascii('XYZ '), 20);
  icc.set(ascii('acsp'), 36);
  v.setUint32(128, 1);
  icc.set(ascii('desc'), 132);
  v.setUint32(136, 144);
  v.setUint32(140, desc.length);
  icc.set(desc, 144);
  return icc;
}

/** Index of `needle` in `haystack`, or -1. */
export function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let k = 0; k < needle.length; k++) if (haystack[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

/** The 24 bytes of the GPS latitude rationals as stored (to prove they were wiped). */
export function latitudeBytes(littleEndian: boolean): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(24);
  const v = new DataView(out.buffer);
  GPS_LATITUDE.forEach(([n, d], k) => {
    v.setUint32(k * 8, n, littleEndian);
    v.setUint32(k * 8 + 4, d, littleEndian);
  });
  return out;
}
