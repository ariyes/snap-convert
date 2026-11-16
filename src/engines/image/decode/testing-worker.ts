// Test-only worker: proves decodeImage runs inside a Web Worker (no DOM), and keeps heavy
// decodes (HEIC) off the test page's main thread. Used by decode.browser.test.ts.
import { DecodeError, decodeImage } from './index';

export interface DecodeWorkerReply {
  ok: boolean;
  hasDocument: boolean;
  width?: number;
  height?: number;
  sourceFormat?: string;
  hasAlpha?: boolean;
  orientation?: number;
  camera?: string;
  hasLocation?: boolean;
  takenAt?: string;
  exifBytes?: number;
  iccBytes?: number;
  topLeft?: number[];
  centre?: number[];
  bottomRight?: number[];
  error?: string;
  code?: string;
}

self.onmessage = async (event: MessageEvent<Blob>) => {
  const hasDocument = typeof (globalThis as { document?: unknown }).document !== 'undefined';
  try {
    const img = await decodeImage(event.data);
    const at = (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return Array.from(img.pixels.data.subarray(i, i + 4));
    };
    const { metadata } = img;
    const reply: DecodeWorkerReply = {
      ok: true,
      hasDocument,
      width: img.width,
      height: img.height,
      sourceFormat: img.sourceFormat,
      hasAlpha: img.hasAlpha,
      orientation: metadata.orientation,
      camera: metadata.camera,
      hasLocation: metadata.hasLocation,
      takenAt: metadata.takenAt,
      exifBytes: metadata.exif?.byteLength,
      iccBytes: metadata.iccProfile?.byteLength,
      topLeft: at(6, 6),
      centre: at(Math.floor(img.width / 2), Math.floor(img.height / 2)),
      bottomRight: at(img.width - 7, img.height - 7),
    };
    self.postMessage(reply);
  } catch (error: unknown) {
    const reply: DecodeWorkerReply = {
      ok: false,
      hasDocument,
      error: error instanceof DecodeError ? error.message : String(error),
      code: error instanceof DecodeError ? error.code : undefined,
    };
    self.postMessage(reply);
  }
};
