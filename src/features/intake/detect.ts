// What kind of file is this? Decided from its first bytes, never from the name or MIME type alone.
// Image formats are recognised by P05's container sniffer (shared, so intake and decode always agree);
// PDF and RAW signatures are checked here. TIFF-based RAW files (NEF, ARW, DNG …) all start like a
// plain TIFF, so for those — and only those — the extension decides.

import type { DetectKind, FileKind } from '@/core/contracts/intake';
import { sniffFormat } from '@/engines/image/decode/container';

/**
 * Bytes read to detect the kind. The checks themselves use the first 32; a little more lets
 * HEIF/AVIF files with a long list of `ftyp` brands be told apart.
 */
export const DETECT_BYTES = 256;

/** PDF readers accept `%PDF-` a little way into the file (after a BOM or stray whitespace). */
const PDF_SEARCH_BYTES = 32;

/** RAW formats built on TIFF, recognised by extension once the bytes say "TIFF". */
export const TIFF_RAW_EXTENSIONS: readonly string[] = [
  'arw',
  'cr2',
  'dng',
  'erf',
  'kdc',
  'mos',
  'nef',
  'nrw',
  'orf',
  'pef',
  'raw',
  'rw2',
  'rwl',
  'sr2',
  'srf',
  'srw',
  '3fr',
  'iiq',
];

/** Every RAW extension the picker offers (TIFF-based plus the ones with their own signature). */
export const RAW_EXTENSIONS: readonly string[] = [...TIFF_RAW_EXTENSIONS, 'cr3', 'raf'];

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && at + i < b.length; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
}

function startsWith(b: Uint8Array, bytes: readonly number[], at = 0): boolean {
  return b.length >= at + bytes.length && bytes.every((v, i) => b[at + i] === v);
}

/** Lower-case extension without the dot ("" if none). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

const TIFF_LE = [0x49, 0x49, 0x2a, 0x00]; // "II*\0"
const TIFF_BE = [0x4d, 0x4d, 0x00, 0x2a]; // "MM\0*"

function isPdf(b: Uint8Array): boolean {
  return ascii(b, 0, PDF_SEARCH_BYTES).includes('%PDF-');
}

/** RAW formats with a signature of their own. */
function hasRawSignature(b: Uint8Array): boolean {
  // Canon CR2: TIFF header, then "CR" and major version 2 at byte 8.
  if (startsWith(b, TIFF_LE) && ascii(b, 8, 2) === 'CR' && b[10] === 2) return true;
  // Canon CR3: ISO-BMFF with major brand "crx ".
  if (ascii(b, 4, 4) === 'ftyp' && ascii(b, 8, 4) === 'crx ') return true;
  // Fujifilm RAF.
  if (ascii(b, 0, 16) === 'FUJIFILMCCD-RAW ') return true;
  // Olympus ORF: TIFF-like with its own magic ("IIRO", "IIRS", "MMOR").
  const head4 = ascii(b, 0, 4);
  if (head4 === 'IIRO' || head4 === 'IIRS' || head4 === 'MMOR') return true;
  // Panasonic RW2 / RWL: "IIU\0".
  if (startsWith(b, [0x49, 0x49, 0x55, 0x00])) return true;
  // Minolta MRW.
  if (startsWith(b, [0x00, 0x4d, 0x52, 0x4d])) return true;
  return false;
}

/**
 * The kind of a file from its first bytes. `name` is only used to tell TIFF-based RAW files
 * from plain TIFFs (which no tool takes, so they are 'unknown').
 */
export function sniffKind(bytes: Uint8Array, name = ''): FileKind {
  switch (sniffFormat(bytes)) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'avif':
    case 'gif':
    case 'bmp':
      return 'image';
    case 'heic':
      return 'heic';
    case 'unknown':
      break;
  }
  if (isPdf(bytes)) return 'pdf';
  if (hasRawSignature(bytes)) return 'raw';
  if (
    (startsWith(bytes, TIFF_LE) || startsWith(bytes, TIFF_BE)) &&
    TIFF_RAW_EXTENSIONS.includes(extensionOf(name))
  ) {
    return 'raw';
  }
  return 'unknown';
}

function nameOf(file: Blob): string {
  return typeof File !== 'undefined' && file instanceof File ? file.name : '';
}

/** Contract `detectKind`: reads only the first bytes of the file. Unreadable files are 'unknown'. */
export const detectKind: DetectKind = async (file) => {
  try {
    const bytes = new Uint8Array(await file.slice(0, DETECT_BYTES).arrayBuffer());
    return sniffKind(bytes, nameOf(file));
  } catch {
    return 'unknown';
  }
};
