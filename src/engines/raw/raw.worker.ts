// The RAW worker (M7): a short-lived worker started by whoever needs a RAW file read (normally
// the image worker). Keeping FlashRaw and LibRaw in their own worker means their WebAssembly memory,
// which never shrinks, is given back when the worker is closed after a develop, and an out-of-memory
// failure can't leave the image worker broken.

import { develop, inspect, preview, RawEngineError } from './engine';
import { flashRawLoadInfo } from './flashraw';
import type { RawFailure, RawReady, RawRequest, RawResponse } from './protocol';

function failure(error: unknown): RawFailure {
  if (error instanceof RawEngineError) return error.failure;
  return { kind: 'damaged', detail: error instanceof Error ? error.message : String(error) };
}

async function handle(
  request: RawRequest,
): Promise<{ response: RawResponse; transfer: Transferable[] }> {
  const { id } = request;
  try {
    switch (request.op) {
      case 'info':
        return { response: { id, ok: true, result: await inspect(request.file) }, transfer: [] };
      case 'preview': {
        const result = await preview(request.file, request.index);
        return { response: { id, ok: true, result }, transfer: result ? [result.jpeg] : [] };
      }
      case 'develop': {
        const result = await develop(request.file, request.options);
        return { response: { id, ok: true, result }, transfer: [result.pixels] };
      }
      case 'status':
        return { response: { id, ok: true, result: flashRawLoadInfo() }, transfer: [] };
    }
  } catch (error) {
    return { response: { id, ok: false, error: failure(error) }, transfer: [] };
  }
}

self.addEventListener('message', (event: MessageEvent<RawRequest>) => {
  void handle(event.data).then(({ response, transfer }) => {
    self.postMessage(response, { transfer });
  });
});

// Tells the caller this script loaded and runs (a worker that never says so failed to start).
self.postMessage({ type: 'ready' } satisfies RawReady);
