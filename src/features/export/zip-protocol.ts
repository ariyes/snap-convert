import type { ExportErrorCode } from './errors';

/** Messages between zip.ts (main thread) and zip.worker.ts. */
export interface ZipRequest {
  files: Array<{ blob: Blob; name: string }>;
}

export type ZipResponse =
  | { type: 'progress'; progress: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; code: ExportErrorCode; message: string };
