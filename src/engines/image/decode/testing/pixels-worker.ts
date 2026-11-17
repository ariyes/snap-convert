// Test-only worker: decodes a file with decodeImage and posts back all of its pixels, so the
// canvas path and the canvas-free path (pixels-worker-no-canvas.ts) can be compared exactly.
import { canvasAvailable } from '../canvas';
import { DecodeError, decodeImage } from '../index';

export interface PixelsReply {
  ok: boolean;
  canvas: boolean;
  width?: number;
  height?: number;
  data?: Uint8ClampedArray<ArrayBuffer>;
  hasAlpha?: boolean;
  orientation?: number;
  sourceFormat?: string;
  error?: string;
  code?: string;
}

self.onmessage = async (event: MessageEvent<Blob>) => {
  const canvas = canvasAvailable();
  try {
    const img = await decodeImage(event.data);
    const data = img.pixels.data;
    const reply: PixelsReply = {
      ok: true,
      canvas,
      width: img.width,
      height: img.height,
      data,
      hasAlpha: img.hasAlpha,
      orientation: img.metadata.orientation,
      sourceFormat: img.sourceFormat,
    };
    self.postMessage(reply, { transfer: [data.buffer] });
  } catch (error: unknown) {
    const reply: PixelsReply = {
      ok: false,
      canvas,
      error: error instanceof Error ? error.message : String(error),
      code: error instanceof DecodeError ? error.code : undefined,
    };
    self.postMessage(reply);
  }
};
