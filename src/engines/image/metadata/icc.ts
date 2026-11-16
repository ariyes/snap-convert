/**
 * ICC colour profiles. Decoding (P05) converts pixels to sRGB, so an output may only carry the
 * original profile when that profile *is* sRGB; any other profile would mis-describe the pixels.
 */
import { SIGNATURE, type JpegSegment, MARKER, MAX_SEGMENT_PAYLOAD } from './jpeg-segments';

/** ASCII text from `start` to `end` (clamped to the buffer and to 256 characters). */
function ascii(b: Uint8Array, start: number, end: number): string {
  let s = '';
  const stop = Math.min(b.length, end, start + 256);
  for (let i = Math.max(0, start); i < stop; i++) s += String.fromCharCode(b[i]!);
  return s;
}

/** Reads the profile description ('desc' tag, ICC v2 'desc' or v4 'mluc' type). Bounds-checked. */
export function iccDescription(icc: Uint8Array): string | undefined {
  if (icc.length < 132) return undefined;
  const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const tagCount = view.getUint32(128);
  if (tagCount > 1000 || 132 + tagCount * 12 > icc.length) return undefined;
  for (let i = 0; i < tagCount; i++) {
    const at = 132 + i * 12;
    if (ascii(icc, at, at + 4) !== 'desc') continue;
    const offset = view.getUint32(at + 4);
    const size = view.getUint32(at + 8);
    if (offset + size > icc.length || size < 12) return undefined;
    const type = ascii(icc, offset, offset + 4);
    if (type === 'desc') {
      const n = view.getUint32(offset + 8);
      if (12 + n > size) return undefined;
      return ascii(icc, offset + 12, offset + 12 + n).replace(/\0+$/, '');
    }
    if (type === 'mluc') {
      if (size < 28) return undefined;
      const records = view.getUint32(offset + 8);
      if (records < 1) return undefined;
      const len = view.getUint32(offset + 20);
      const start = view.getUint32(offset + 24);
      if (start + len > size) return undefined;
      let s = '';
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(view.getUint16(offset + start + k));
      return s.replace(/\0+$/, '');
    }
    return undefined;
  }
  return undefined;
}

/** True for RGB display profiles that describe sRGB (e.g. "sRGB IEC61966-2.1", "sRGB built-in"). */
export function isSrgbProfile(icc: Uint8Array | ArrayBuffer): boolean {
  const bytes = icc instanceof Uint8Array ? icc : new Uint8Array(icc);
  if (bytes.length < 132 || ascii(bytes, 36, 40) !== 'acsp') return false;
  if (ascii(bytes, 16, 20) !== 'RGB ') return false;
  const desc = iccDescription(bytes);
  return desc !== undefined && /\bsrgb\b/i.test(desc);
}

/** Splits a profile into APP2 "ICC_PROFILE" segments (each ≤ 64 KB, numbered 1…n). */
export function iccSegments(icc: Uint8Array): JpegSegment[] {
  const header = SIGNATURE.icc.length + 2;
  const chunk = MAX_SEGMENT_PAYLOAD - header;
  const total = Math.ceil(icc.length / chunk);
  if (total === 0 || total > 255) return [];
  const out: JpegSegment[] = [];
  for (let i = 0; i < total; i++) {
    const part = icc.subarray(i * chunk, (i + 1) * chunk);
    const data = new Uint8Array(header + part.length);
    for (let k = 0; k < SIGNATURE.icc.length; k++) data[k] = SIGNATURE.icc.charCodeAt(k);
    data[header - 2] = i + 1;
    data[header - 1] = total;
    data.set(part, header);
    out.push({ marker: MARKER.APP2, data });
  }
  return out;
}
