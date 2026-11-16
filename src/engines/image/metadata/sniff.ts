import type { ImageFormat } from '@/core/contracts/image';

/** Identifies an encoded image from its first bytes. */
export function sniffFormat(b: Uint8Array): ImageFormat | 'unknown' {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'png';
  }
  const text = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && text(4, 8) === 'ftyp') {
    // Major brand, then (after a 4-byte version) the compatible brands, up to the box end.
    const boxEnd = Math.min(b.length, ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0, 256);
    for (let at = 8; at + 4 <= boxEnd; at += at === 8 ? 8 : 4) {
      if (/^avi[fs]$/.test(text(at, at + 4))) return 'avif';
    }
  }
  return 'unknown';
}
