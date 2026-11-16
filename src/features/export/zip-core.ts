// Streaming ZIP writer. Runs inside the ZIP worker (zip.worker.ts); imports fflate statically, so
// never import this file from main-thread code (it would put fflate in the startup bundle).
import { Zip, ZipDeflate, ZipPassThrough, type ZipInputFile } from 'fflate';
import { ExportError } from './errors';
import { safeFileName, splitExtension, uniqueNames } from './names';

export interface ZipEntry {
  blob: Blob;
  name: string;
}

/** Bytes read from an input blob at a time. */
export const READ_CHUNK_BYTES = 4 * 1024 * 1024;
/** ZIP output is gathered into a Blob every this many bytes, so it can leave the JS heap. */
export const FLUSH_BYTES = 16 * 1024 * 1024;
/** fflate writes classic ZIP (no ZIP64): every offset and the archive must stay under 4 GiB. */
export const MAX_ZIP_BYTES = 0xffff_ffff;
export const MAX_ZIP_ENTRIES = 0xffff;

/** Formats that are already compressed: storing them is as small as deflating and far faster. */
const STORED_EXTENSIONS = new Set(
  'jpg jpeg jpe jfif png apng webp avif heic heif jxl gif pdf zip gz 7z rar mp4 mov webm mp3 m4a woff2'.split(
    ' ',
  ),
);
const STORED_TYPES =
  /^(image\/(jpeg|png|apng|webp|avif|heic|heif|jxl|gif)|application\/(pdf|zip|gzip)|video\/|audio\/)/i;

export function shouldStore(name: string, type: string): boolean {
  const ext = splitExtension(name)[1].slice(1).toLowerCase();
  return STORED_EXTENSIONS.has(ext) || STORED_TYPES.test(type);
}

const encoder = new TextEncoder();

/** Upper bound of the finished archive's size (headers + data + central directory). */
function estimateZipBytes(files: ReadonlyArray<ZipEntry>, names: string[]): number {
  let total = 22; // end of central directory
  files.forEach((file, i) => {
    const nameBytes = encoder.encode(names[i]).length;
    const data = shouldStore(names[i] ?? '', file.blob.type)
      ? file.blob.size
      : Math.ceil(file.blob.size * 1.001) + 64; // deflate's worst case for incompressible data
    total += 30 + nameBytes + data + 16 + 46 + nameBytes; // local header, data, descriptor, central entry
  });
  return total;
}

/** Loose output bytes below this size stay as they are instead of becoming a Blob of their own. */
const INLINE_BYTES = 64 * 1024;

/**
 * Collects the archive as a list of Blob parts without keeping it in JS memory.
 * - Stored file data is never copied: the chunk fflate passes through is swapped for the matching
 *   slice of the input blob, so the finished ZIP refers to the input's data.
 * - Other output (headers, deflated data) is folded into Blobs every FLUSH_BYTES, which the
 *   browser keeps outside the JS heap (and may move to disk).
 */
class ZipOutput {
  private readonly parts: BlobPart[] = [];
  private loose: Uint8Array[] = [];
  private looseBytes = 0;
  /** Chunks read from an input blob, mapped to the slice of that blob they came from. */
  readonly sources = new Map<Uint8Array, Blob>();

  add(chunk: Uint8Array): void {
    const source = this.sources.get(chunk);
    if (source) {
      this.settle();
      this.parts.push(source);
      return;
    }
    this.loose.push(chunk);
    this.looseBytes += chunk.length;
    if (this.looseBytes >= FLUSH_BYTES) this.settle();
  }

  /** Moves loose bytes into the part list, as one Blob if they are big. */
  private settle(): void {
    if (this.loose.length === 0) return;
    if (this.looseBytes >= INLINE_BYTES) this.parts.push(new Blob(this.loose as BlobPart[]));
    else this.parts.push(...(this.loose as BlobPart[]));
    this.loose = [];
    this.looseBytes = 0;
  }

  toBlob(): Blob {
    this.settle();
    return new Blob(this.parts, { type: 'application/zip' });
  }
}

/**
 * Builds a ZIP from blobs without holding a second copy in memory: inputs are read in chunks
 * (for the CRC), already-compressed formats are stored by reference to the input, others are
 * deflated and gathered into Blobs as they come. Names are made safe and unique.
 * Progress goes from 0 to 1.
 */
export async function buildZip(
  files: ReadonlyArray<ZipEntry>,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  if (files.length > MAX_ZIP_ENTRIES) throw new ExportError('zip-too-many-files');
  const names = uniqueNames(files.map((f) => safeFileName(f.name)));
  if (estimateZipBytes(files, names) > MAX_ZIP_BYTES) throw new ExportError('zip-too-large');

  const output = new ZipOutput();
  const state: { error: Error | null } = { error: null };
  const zip = new Zip((err, chunk) => {
    if (err) state.error = err;
    else output.add(chunk);
  });

  // Each file counts as one extra unit so empty files still move the bar.
  const totalUnits = files.reduce((sum, f) => sum + f.blob.size + 1, 0);
  let doneUnits = 0;
  let reported = -1;
  const report = (progress: number) => {
    if (progress === 1 || progress - reported >= 0.005) {
      reported = progress;
      onProgress?.(progress);
    }
  };
  const check = () => {
    if (state.error)
      throw new ExportError('zip-failed', state.error.message, { cause: state.error });
  };

  report(0);
  const mtime = new Date();
  try {
    for (const [i, { blob }] of files.entries()) {
      const name = names[i] ?? '';
      const store = shouldStore(name, blob.type);
      const entry: ZipInputFile & { push(chunk: Uint8Array, final?: boolean): void } = store
        ? new ZipPassThrough(name)
        : new ZipDeflate(name, { level: 6 });
      entry.mtime = mtime;
      zip.add(entry);
      if (blob.size === 0) entry.push(new Uint8Array(0), true);
      for (let start = 0; start < blob.size; start += READ_CHUNK_BYTES) {
        const end = Math.min(start + READ_CHUNK_BYTES, blob.size);
        const slice = blob.slice(start, end);
        const chunk = new Uint8Array(await slice.arrayBuffer());
        if (store) output.sources.set(chunk, slice);
        entry.push(chunk, end === blob.size);
        output.sources.delete(chunk);
        check();
        doneUnits += chunk.length;
        report(doneUnits / totalUnits);
      }
      doneUnits += 1;
      report(doneUnits / totalUnits);
    }
    zip.end();
    check();
  } catch (err) {
    zip.terminate();
    if (err instanceof ExportError) throw err;
    throw new ExportError('zip-failed', err instanceof Error ? err.message : String(err), {
      cause: err,
    });
  }
  report(1);
  return output.toBlob();
}
