import { ExportError } from './errors';
import type { ZipRequest, ZipResponse } from './zip-protocol';

/**
 * Packs files into one ZIP in a Web Worker (fflate loads only then). Names are made safe and
 * unique; JPG, PNG, WebP, AVIF and PDF are stored, other files deflated. Progress goes 0 → 1.
 * Rejects with an ExportError ('zip-too-large', 'zip-too-many-files' or 'zip-failed').
 */
export function zipFiles(
  files: Array<{ blob: Blob; name: string }>,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./zip.worker.ts', import.meta.url), {
      type: 'module',
      name: 'zip',
    });
    worker.onmessage = (event: MessageEvent<ZipResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress?.(message.progress);
        return;
      }
      worker.terminate();
      if (message.type === 'done') resolve(message.blob);
      else reject(new ExportError(message.code, message.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new ExportError('zip-failed', event.message));
    };
    const request: ZipRequest = { files: files.map(({ blob, name }) => ({ blob, name })) };
    worker.postMessage(request);
  });
}
