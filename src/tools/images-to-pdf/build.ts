// Building the PDF: first make every image PDF-ready (image worker, only when needed), then one
// `images-to-pdf` job on the PDF worker. Both run through the shared queue.

import type { ImageJobInput, ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import type { ImagesToPdfInput, PdfOutput, PdfResult } from '@/core/contracts/pdf';
import type { PdfOp } from '@/engines/pdf';
import { conversionFor, imageType, readHead, reencodeFor } from './prepare';
import { JobCancelled, runQueued, type QueueLike } from './queue-job';
import { strings } from './strings';
import { stripLocation } from './strip-location';
import { toPdfPageOptions, type ImagesToPdfSettings, type QualityChoice } from './settings';

const IMAGES_TO_PDF: PdfOp = 'images-to-pdf';

/** An image couldn't be made ready for the PDF. */
export class ImageFailed extends Error {
  constructor(
    readonly fileId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImageFailed';
  }
}

type FileIn = Pick<IntakeFile, 'id' | 'file' | 'name' | 'width' | 'height'>;

interface Entry {
  promise: Promise<Blob>;
  jobId: string | null;
}

/**
 * PDF-ready images per file and quality setting, so reordering or a second build doesn't convert
 * the same image again. Failed or cancelled conversions are forgotten (they're tried again).
 */
export class ConversionCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly queue: QueueLike) {}

  private static key(fileId: string, quality: QualityChoice): string {
    return `${fileId}\u0000${quality}`;
  }

  /**
   * The PDF-ready blob of `file`: with Original quality a PNG as it is and a JPEG without its
   * location data, otherwise the result of an image job (started here unless one is running).
   * `jobId` is set only when this call started the job.
   */
  async ensure(
    file: FileIn,
    quality: QualityChoice,
    onProgress?: (p: number) => void,
  ): Promise<{ promise: Promise<Blob>; jobId: string | null; converted: boolean }> {
    const key = ConversionCache.key(file.id, quality);
    const existing = this.entries.get(key);
    if (existing) {
      return { promise: existing.promise, jobId: null, converted: existing.jobId !== null };
    }

    const head = await readHead(file.file);
    let input: ImageJobInput | null = conversionFor(file, head, quality);
    // A JPEG kept as it is loses its location data first (pixels untouched). One whose header
    // can't be read safely is re-encoded instead, so its location can't slip through.
    let stripped: Blob | null = null;
    if (!input && imageType(head) === 'jpeg') {
      stripped = await stripLocation(file.file);
      if (!stripped) input = reencodeFor(file);
    }
    // Another call may have started it while the file was being read.
    const raced = this.entries.get(key);
    if (raced) return { promise: raced.promise, jobId: null, converted: raced.jobId !== null };
    if (!input) {
      const promise = Promise.resolve(stripped ?? file.file);
      if (stripped) this.entries.set(key, { promise, jobId: null });
      return { promise, jobId: null, converted: false };
    }

    const job = runQueued<ImageJobInput, ImageJobResult>(
      this.queue,
      'image',
      'process',
      file.name,
      input,
      onProgress,
    );
    const promise = job.done.then(
      (result) => result.blob,
      (error: unknown) => {
        if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
        throw error;
      },
    );
    this.entries.set(key, { promise, jobId: job.id });
    return { promise, jobId: job.id, converted: true };
  }

  /** Forgets a file's results (it was removed from the list). */
  forget(fileId: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${fileId}\u0000`)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface BuildOptions {
  files: readonly FileIn[];
  settings: ImagesToPdfSettings;
  outName: string;
  queue: QueueLike;
  cache: ConversionCache;
  /** Overall progress, 0–1. */
  onProgress?: (p: number) => void;
  /** Every job this build starts (so the page can cancel them). */
  onJob?: (id: string) => void;
  signal?: AbortSignal;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new JobCancelled());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new JobCancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Builds the PDF, one page per file in the given order. */
export async function buildPdf(o: BuildOptions): Promise<PdfOutput> {
  const n = o.files.length;
  // The PDF step counts like a few images, so the bar doesn't sit at the end while pages are added.
  const pdfWeight = Math.max(1, Math.ceil(n / 4));
  const conversion = new Map<number, number>();
  let pdfProgress = 0;
  const report = () => {
    if (!o.onProgress) return;
    let sum = 0;
    for (const p of conversion.values()) sum += p;
    o.onProgress((sum + pdfProgress * pdfWeight) / (conversion.size + pdfWeight));
  };

  const prepared = await abortable(
    Promise.all(
      o.files.map(async (file, i) => {
        const { promise, jobId, converted } = await o.cache.ensure(
          file,
          o.settings.quality,
          (p) => {
            conversion.set(i, p);
            report();
          },
        );
        if (jobId) o.onJob?.(jobId);
        if (converted && !conversion.has(i)) conversion.set(i, 0);
        report();
        try {
          const blob = await promise;
          if (converted) conversion.set(i, 1);
          report();
          return { blob, name: file.name };
        } catch (error) {
          if (error instanceof JobCancelled) throw error;
          throw new ImageFailed(file.id, error instanceof Error ? error.message : String(error));
        }
      }),
    ),
    o.signal,
  );

  const input: ImagesToPdfInput = {
    images: prepared,
    ...toPdfPageOptions(o.settings),
    outName: o.outName,
  };
  const job = runQueued<ImagesToPdfInput, PdfResult>(
    o.queue,
    'pdf',
    IMAGES_TO_PDF,
    o.outName,
    input,
    (p) => {
      pdfProgress = p;
      report();
    },
  );
  o.onJob?.(job.id);
  const result = await abortable(job.done, o.signal);
  const file = result.files[0];
  if (!file) throw new Error(strings.noPdf);
  return file;
}
