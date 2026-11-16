// Quick image size from the file header, without decoding pixels or loading any decoder.
// Reads at most HEADER_READ_BYTES of each file. The container parsing is P05's (`readContainer`),
// so intake and decode always agree on a file's stored size; this module adds the upright size
// (EXIF orientation 5–8 or a HEIF/AVIF quarter turn swaps width and height) and a check that the
// size really came from bytes we have.

import type { ContainerInfo } from '@/engines/image/decode/container';
import { readContainer } from '@/engines/image/decode/container';
import { swapsAxes } from '@/engines/image/decode/orientation';

/** Never read more than this from one file (256 KB). */
export const HEADER_READ_BYTES = 256 * 1024;

/** Upright size in pixels, as the image will be shown. */
export interface HeaderSize {
  width: number;
  height: number;
}

/** Largest width or height any of the formats can store (VP8X / ISO-BMFF use up to 32 bits). */
const MAX_SIDE = 0x7fff_ffff;

function validSide(n: number | undefined): n is number {
  return n !== undefined && Number.isInteger(n) && n > 0 && n <= MAX_SIDE;
}

/**
 * How many bytes of filler the cross-check appends. Every size field P05 reads sits within a few
 * bytes of a segment, chunk or box header that is itself inside the data.
 */
const CROSS_CHECK_PAD = 64;

/**
 * Parses twice: as is, and with 0xFF filler after the end. P05's reader treats bytes past the end
 * as 0, so a header cut short could yield a plausible but wrong size (e.g. 3840 instead of 4032).
 * If the filler changes the result, the size came from bytes we don't have, and we say "unknown".
 */
async function readComplete(bytes: Uint8Array): Promise<ContainerInfo | undefined> {
  const info = await readContainer(bytes);
  if (!validSide(info.width) || !validSide(info.height)) return undefined;
  const padded = new Uint8Array(bytes.length + CROSS_CHECK_PAD);
  padded.set(bytes);
  padded.fill(0xff, bytes.length);
  const check = await readContainer(padded);
  const same =
    check.width === info.width &&
    check.height === info.height &&
    JSON.stringify(check.transforms ?? []) === JSON.stringify(info.transforms ?? []);
  return same ? info : undefined;
}

// ---------- EXIF orientation (TIFF IFD0, tag 0x0112) ----------

/**
 * EXIF orientation (1–8) from a TIFF-structured EXIF block, or undefined if it is missing or
 * broken. Every read is bounds-checked. (P05 parses EXIF with exifr, which is loaded on demand
 * inside the worker; intake only needs this one tag, on the main thread.)
 */
export function readExifOrientation(tiff: Uint8Array | undefined): number | undefined {
  if (!tiff || tiff.length < 8) return undefined;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  const be = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!le && !be) return undefined;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (at: number) => view.getUint16(at, le);
  const u32 = (at: number) => view.getUint32(at, le);
  if (u16(2) !== 42) return undefined;
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > tiff.length) return undefined;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return undefined;
    if (u16(entry) !== 0x0112) continue;
    const type = u16(entry + 2);
    // SHORT (3) is standard; some writers use LONG (4).
    const value = type === 3 ? u16(entry + 8) : type === 4 ? u32(entry + 8) : 0;
    return value >= 1 && value <= 8 ? value : undefined;
  }
  return undefined;
}

/** True when the container's rotations add up to a quarter turn (90° or 270°). */
function quarterTurn(info: ContainerInfo): boolean {
  let degrees = 0;
  for (const t of info.transforms ?? []) if ('rotate' in t) degrees += t.rotate;
  return degrees % 180 === 90;
}

/** True when width and height must be swapped to get the upright size. */
function swaps(info: ContainerInfo): boolean {
  switch (info.format) {
    case 'jpeg':
    case 'png':
    case 'webp':
      return swapsAxes(readExifOrientation(info.exif) ?? 1);
    case 'avif':
    case 'heic':
      // HEIF/AVIF rotate in the container (irot); their EXIF orientation only repeats it (as in P05).
      return quarterTurn(info);
    default:
      return false;
  }
}

/** Upright size from the first bytes of an image file. Never throws; undefined if it can't be read. */
export async function headerSizeFromBytes(bytes: Uint8Array): Promise<HeaderSize | undefined> {
  try {
    const head = bytes.length > HEADER_READ_BYTES ? bytes.subarray(0, HEADER_READ_BYTES) : bytes;
    const info = await readComplete(head);
    if (!info || !validSide(info.width) || !validSide(info.height)) return undefined;
    return swaps(info)
      ? { width: info.height, height: info.width }
      : { width: info.width, height: info.height };
  } catch {
    return undefined;
  }
}

/** Reads the first {@link HEADER_READ_BYTES} of a file. Throws if the file can't be read. */
export async function readHead(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, HEADER_READ_BYTES).arrayBuffer());
}

/** Upright size of an image file from its header (at most 256 KB read). Never throws. */
export async function readHeaderSize(file: Blob): Promise<HeaderSize | undefined> {
  try {
    return await headerSizeFromBytes(await readHead(file));
  } catch {
    return undefined;
  }
}
