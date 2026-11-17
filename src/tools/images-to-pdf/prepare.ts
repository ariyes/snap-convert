// What each image needs before it can go into the PDF. PDFs can only hold JPEG and PNG, so other
// formats are converted by the image worker first; "Smaller file" sends every image through the
// image pipeline. Everything here reads only the first bytes of a file (no decoding).

import type { ImageJobInput } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import { CONVERT_JPEG_QUALITY, SMALLER_FILE, type QualityChoice } from './settings';

export type ImageType = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'bmp' | 'unknown';

/** Bytes read from the start of a file to find its type and whether it can be transparent. */
export const HEAD_BYTES = 256 * 1024;

const ascii = (b: Uint8Array, at: number, len: number): string => {
  let s = '';
  for (let i = 0; i < len && at + i < b.length; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
};

const startsWith = (b: Uint8Array, bytes: readonly number[]): boolean =>
  bytes.every((v, i) => b[i] === v);

const AVIF_BRANDS = ['avif', 'avis'];
const HEIF_BRANDS = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
];

/** Image type from the first bytes, never from the name. */
export function imageType(b: Uint8Array): ImageType {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  const six = ascii(b, 0, 6);
  if (six === 'GIF87a' || six === 'GIF89a') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (ascii(b, 4, 4) === 'ftyp') {
    const size =
      (((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0)) >>> 0;
    const brands = [ascii(b, 8, 4)];
    for (let at = 16; at + 4 <= Math.min(size, b.length); at += 4) brands.push(ascii(b, at, 4));
    if (brands.some((x) => AVIF_BRANDS.includes(x))) return 'avif';
    if (brands.some((x) => HEIF_BRANDS.includes(x))) return 'heic';
  }
  return 'unknown';
}

function contains(b: Uint8Array, text: string): boolean {
  const first = text.charCodeAt(0);
  outer: for (
    let i = b.indexOf(first);
    i !== -1 && i + text.length <= b.length;
    i = b.indexOf(first, i + 1)
  ) {
    for (let j = 1; j < text.length; j++) if (b[i + j] !== text.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

/**
 * Might this WebP, AVIF or HEIC image have transparency? Read from the container, so it can say
 * yes for an image whose alpha is fully opaque — then it's kept as (lossless) PNG, which is safe.
 */
export function mayHaveAlpha(b: Uint8Array, type: ImageType): boolean {
  switch (type) {
    case 'webp': {
      const chunk = ascii(b, 12, 4);
      if (chunk === 'VP8X') return ((b[20] ?? 0) & 0x10) !== 0; // alpha flag
      if (chunk === 'VP8L') return ((b[24] ?? 0) & 0x10) !== 0; // alpha_is_used bit
      return false; // 'VP8 ': simple lossy, never transparent
    }
    case 'avif':
    case 'heic':
      // An alpha plane is an auxiliary image tagged with one of these URNs in the `meta` box.
      return contains(b, 'auxiliary:alpha') || contains(b, 'urn:mpeg:hevc:2015:auxid:1\0');
    case 'png':
    case 'gif':
    case 'bmp':
      return true;
    default:
      return false;
  }
}

/** The settings of the image job that makes `file` ready for the PDF, or null when it already is. */
export function conversionFor(
  file: Pick<IntakeFile, 'file' | 'name' | 'width' | 'height'>,
  head: Uint8Array,
  quality: QualityChoice,
): ImageJobInput | null {
  const type = imageType(head);
  const base = {
    file: file.file,
    name: file.name,
    metadata: 'strip-all' as const,
    width: file.width,
    height: file.height,
  };

  if (quality === 'smaller') {
    // Longest side 2480 px (A4 at 300 dpi), JPEG 85 with the quality guard (D28/D29). Transparent
    // parts go on white, the colour of the page they're drawn on.
    return {
      ...base,
      resize: { mode: 'longest', value: SMALLER_FILE.longestSide, upscale: false },
      format: 'jpeg',
      quality: SMALLER_FILE.quality,
      background: '#ffffff',
      qualityGuard: true,
    };
  }

  if (type === 'jpeg' || type === 'png') return null;
  // GIF and BMP are graphics or uncompressed: PNG keeps them exactly. Others keep transparency
  // as PNG and become JPEG 92 when they can't be transparent.
  const png = type === 'gif' || type === 'bmp' || mayHaveAlpha(head, type);
  return {
    ...base,
    format: png ? 'png' : 'jpeg',
    quality: CONVERT_JPEG_QUALITY,
    qualityGuard: false,
  };
}

/** Reads the first {@link HEAD_BYTES} of a file. */
export async function readHead(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
}
