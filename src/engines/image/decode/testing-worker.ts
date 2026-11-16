// Test-only worker: proves decodeImage runs inside a Web Worker (no DOM). Used by decode.browser.test.ts.
import { DecodeError, decodeImage } from './index';

export interface DecodeWorkerReply {
  ok: boolean;
  width?: number;
  height?: number;
  sourceFormat?: string;
  orientation?: number;
  topLeft?: number[];
  bottomRight?: number[];
  error?: string;
  hasDocument: boolean;
}

self.onmessage = async (event: MessageEvent<Blob>) => {
  const hasDocument = typeof (globalThis as { document?: unknown }).document !== 'undefined';
  try {
    const img = await decodeImage(event.data);
    const at = (x: number, y: number) => Array.from(img.pixels.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    const reply: DecodeWorkerReply = {
      ok: true,
      width: img.width,
      height: img.height,
      sourceFormat: img.sourceFormat,
      orientation: img.metadata.orientation,
      topLeft: at(6, 6),
      bottomRight: at(img.width - 7, img.height - 7),
      hasDocument,
    };
    self.postMessage(reply);
  } catch (error: unknown) {
    const reply: DecodeWorkerReply = {
      ok: false,
      error: error instanceof DecodeError ? error.message : String(error),
      hasDocument,
    };
    self.postMessage(reply);
  }
};
