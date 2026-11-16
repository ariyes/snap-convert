// Turning dropped, picked or pasted Files into IntakeFiles: kind from the first bytes, quick size
// from the header, and the rules for which files a tool keeps.

import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { toast } from '@/ui';
import { DETECT_BYTES, RAW_EXTENSIONS, sniffKind } from './detect';
import { headerSizeFromBytes, readHead } from './header';
import { intakeStrings } from './strings';

/** Files read at the same time. Reads are small (≤ 256 KB) but there may be thousands. */
const READ_CONCURRENCY = 8;

let fallbackId = 0;
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // randomUUID needs a secure context; fall through.
  }
  fallbackId += 1;
  return `intake-${Date.now().toString(36)}-${fallbackId}`;
}

/** Reads one file: kind from the first bytes and, for images, the upright size from the header. */
export async function toIntakeFile(file: File): Promise<IntakeFile> {
  const base = { id: newId(), file, name: file.name, size: file.size };
  let head: Uint8Array;
  try {
    head = await readHead(file);
  } catch {
    return { ...base, kind: 'unknown', error: intakeStrings.unreadableFile };
  }
  const kind = sniffKind(head.subarray(0, DETECT_BYTES), file.name);
  const out: IntakeFile = { ...base, kind };
  if (kind === 'image' || kind === 'heic') {
    const size = await headerSizeFromBytes(head);
    if (size) {
      out.width = size.width;
      out.height = size.height;
    }
  }
  return out;
}

/** Reads many files, a few at a time, keeping their order. */
export async function toIntakeFiles(files: readonly File[]): Promise<IntakeFile[]> {
  const out = new Array<IntakeFile>(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const file = files[i];
      if (file) out[i] = await toIntakeFile(file);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
  return out;
}

export interface Partitioned {
  kept: IntakeFile[];
  /** Readable files of a kind the tool doesn't take. */
  wrongKind: IntakeFile[];
  /** Files whose bytes couldn't be read at all. */
  unreadable: IntakeFile[];
}

/** Splits files into the ones a tool takes and the ones it doesn't. */
export function partitionByKind(
  files: readonly IntakeFile[],
  accept: readonly FileKind[],
): Partitioned {
  const out: Partitioned = { kept: [], wrongKind: [], unreadable: [] };
  for (const f of files) {
    if (f.error && f.kind === 'unknown') out.unreadable.push(f);
    else if (accept.includes(f.kind)) out.kept.push(f);
    else out.wrongKind.push(f);
  }
  return out;
}

/**
 * Keeps the files a tool takes. The others are left out with a toast:
 * "3 files skipped — this tool takes images only".
 */
export function keepAccepted(
  files: readonly IntakeFile[],
  accept: readonly FileKind[],
): IntakeFile[] {
  const { kept, wrongKind, unreadable } = partitionByKind(files, accept);
  if (wrongKind.length > 0) toast(intakeStrings.skipped(wrongKind.length, accept));
  if (unreadable.length > 0) toast(intakeStrings.unreadable(unreadable.length));
  return kept;
}

/**
 * The picker's `accept` attribute. `image/*` (without `capture`) makes phones offer the camera roll
 * as well as the camera and files. The picker filter is only a convenience: whatever comes back is
 * still checked by its bytes.
 */
export function acceptAttribute(accept: readonly FileKind[]): string {
  const parts: string[] = [];
  const add = (...items: string[]) => {
    for (const item of items) if (!parts.includes(item)) parts.push(item);
  };
  for (const kind of accept) {
    if (kind === 'image') add('image/*', '.avif');
    else if (kind === 'heic') add('image/heic', 'image/heif', '.heic', '.heif');
    else if (kind === 'pdf') add('application/pdf', '.pdf');
    else if (kind === 'raw') add(...RAW_EXTENSIONS.map((ext) => `.${ext}`));
  }
  return parts.join(',');
}

// ---------- Pasted files ----------

let pasteCount = 0;

/** For tests: start pasted names from 1 again. */
export function resetPasteCount(): void {
  pasteCount = 0;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tif',
  'application/pdf': 'pdf',
};

/** Browsers name clipboard images "image.png" (or nothing); real copied files keep their names. */
function hasGenericName(file: File): boolean {
  return !file.name || /^image\.[a-z0-9]+$/i.test(file.name);
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Gives a pasted screenshot a useful name: pasted-2026-11-16-1.png. Other files keep theirs. */
export function namePastedFile(file: File, now = new Date()): File {
  if (!hasGenericName(file)) return file;
  pasteCount += 1;
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  const ext = EXT_BY_TYPE[file.type] ?? fromName ?? 'png';
  const name = intakeStrings.pastedName(localDate(now), pasteCount, ext);
  return new File([file], name, { type: file.type, lastModified: file.lastModified });
}
