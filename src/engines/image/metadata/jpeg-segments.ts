/**
 * Reading and writing the header segments of a JPEG file. Input is untrusted: every read is
 * bounds-checked, the cursor always moves forward (so the loop always ends), and anything
 * malformed throws a `JpegFormatError` with a readable message.
 */
import { metadataStrings as t } from './strings';

export class JpegFormatError extends Error {
  override readonly name = 'JpegFormatError';
}

export const MARKER = {
  SOI: 0xd8,
  EOI: 0xd9,
  SOS: 0xda,
  APP0: 0xe0,
  APP1: 0xe1,
  APP2: 0xe2,
  APP14: 0xee,
  COM: 0xfe,
} as const;

/** Largest payload a segment can hold: the 16-bit length counts itself (2 bytes). */
export const MAX_SEGMENT_PAYLOAD = 0xffff - 2;

export interface JpegSegment {
  /** Marker code, e.g. 0xE1 for APP1. */
  marker: number;
  /** Payload after the 2-byte length. A view into the original bytes. */
  data: Uint8Array;
}

export interface ParsedJpeg {
  /** Header segments between SOI and the first SOS, in file order. */
  segments: JpegSegment[];
  /** Everything from the first SOS marker to the end of the file, copied through untouched. */
  scan: Uint8Array;
}

/** SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC). */
export function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

export function parseJpeg(bytes: Uint8Array): ParsedJpeg {
  const len = bytes.length;
  if (len < 4 || bytes[0] !== 0xff || bytes[1] !== MARKER.SOI) {
    throw new JpegFormatError(t.notJpeg);
  }
  const segments: JpegSegment[] = [];
  let sawFrame = false;
  let pos = 2;
  for (;;) {
    if (pos >= len) throw new JpegFormatError(t.truncated);
    if (bytes[pos] !== 0xff) throw new JpegFormatError(t.badMarker(pos));
    const start = pos;
    // Any number of 0xFF fill bytes may come before a marker code.
    while (pos < len && bytes[pos] === 0xff) pos++;
    if (pos >= len) throw new JpegFormatError(t.truncated);
    const marker = bytes[pos]!;
    pos++;
    if (marker === 0x00) throw new JpegFormatError(t.badMarker(start));
    if (marker === MARKER.SOI) throw new JpegFormatError(t.doubleStart);
    if (marker === MARKER.EOI) throw new JpegFormatError(t.truncated);
    if (isStandalone(marker)) continue;
    if (marker === MARKER.SOS) {
      if (!sawFrame) throw new JpegFormatError(t.noFrame);
      return { segments, scan: bytes.subarray(start) };
    }
    if (pos + 2 > len) throw new JpegFormatError(t.truncated);
    const length = (bytes[pos]! << 8) | bytes[pos + 1]!;
    if (length < 2) throw new JpegFormatError(t.badLength(start));
    if (pos + length > len) throw new JpegFormatError(t.truncated);
    if (isFrameMarker(marker)) sawFrame = true;
    segments.push({ marker, data: bytes.subarray(pos + 2, pos + length) });
    pos += length;
  }
}

/** Builds a JPEG from header segments plus the untouched scan data (which starts at SOS). */
export function writeJpeg(segments: readonly JpegSegment[], scan: Uint8Array): Uint8Array<ArrayBuffer> {
  let size = 2 + scan.length;
  for (const s of segments) {
    if (s.data.length > MAX_SEGMENT_PAYLOAD) throw new JpegFormatError(t.segmentTooLong);
    size += 4 + s.data.length;
  }
  const out = new Uint8Array(size);
  out[0] = 0xff;
  out[1] = MARKER.SOI;
  let pos = 2;
  for (const s of segments) {
    const length = s.data.length + 2;
    out[pos] = 0xff;
    out[pos + 1] = s.marker;
    out[pos + 2] = length >> 8;
    out[pos + 3] = length & 0xff;
    out.set(s.data, pos + 4);
    pos += 4 + s.data.length;
  }
  out.set(scan, pos);
  return out;
}

export interface FrameInfo {
  width: number;
  height: number;
  progressive: boolean;
  components: Array<{ id: number; h: number; v: number }>;
}

/** Reads image size and sampling factors from the frame header (SOF). */
export function readFrame(parsed: ParsedJpeg): FrameInfo {
  const sof = parsed.segments.find((s) => isFrameMarker(s.marker));
  if (!sof) throw new JpegFormatError(t.noFrame);
  const d = sof.data;
  if (d.length < 6) throw new JpegFormatError(t.badFrame);
  const count = d[5]!;
  if (d.length < 6 + count * 3) throw new JpegFormatError(t.badFrame);
  const components = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 3;
    components.push({ id: d[o]!, h: d[o + 1]! >> 4, v: d[o + 1]! & 0x0f });
  }
  return {
    height: (d[1]! << 8) | d[2]!,
    width: (d[3]! << 8) | d[4]!,
    progressive: sof.marker === 0xc2 || sof.marker === 0xc6 || sof.marker === 0xca || sof.marker === 0xce,
    components,
  };
}

/** '4:4:4', '4:2:0', '4:2:2', 'gray' or 'other', from the frame's sampling factors. */
export function chromaSubsampling(frame: FrameInfo): '4:4:4' | '4:2:0' | '4:2:2' | 'gray' | 'other' {
  const [y, cb, cr] = frame.components;
  if (frame.components.length === 1) return 'gray';
  if (!y || !cb || !cr || frame.components.length !== 3) return 'other';
  if (cb.h !== cr.h || cb.v !== cr.v || cb.h !== 1 || cb.v !== 1) return 'other';
  if (y.h === 1 && y.v === 1) return '4:4:4';
  if (y.h === 2 && y.v === 2) return '4:2:0';
  if (y.h === 2 && y.v === 1) return '4:2:2';
  return 'other';
}

/** True if `data` starts with the given ASCII signature (e.g. "Exif\0\0"). */
export function startsWith(data: Uint8Array, signature: string): boolean {
  if (data.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (data[i] !== signature.charCodeAt(i)) return false;
  }
  return true;
}

export const SIGNATURE = {
  exif: 'Exif\0\0',
  xmp: 'http://ns.adobe.com/xap/1.0/\0',
  xmpExtended: 'http://ns.adobe.com/xmp/extension/\0',
  icc: 'ICC_PROFILE\0',
  jfif: 'JFIF\0',
  jfxx: 'JFXX\0',
  adobe: 'Adobe',
} as const;
