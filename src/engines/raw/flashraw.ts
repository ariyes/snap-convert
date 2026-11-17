// FlashRaw (MIT/Apache-2.0, D40), the primary RAW decoder. Runs only inside the RAW worker.
// Its .wasm files are our own static assets (same origin, no user data sent), passed explicitly so
// the dev server's dependency pre-bundling can't break FlashRaw's own `new URL(…)` lookups.
// The multithreaded build is used only when the page is cross-origin isolated (D43), with at most
// four threads; everything works single-threaded.

import type * as FlashRawNamespace from 'flashraw';
import type { DecodedFrame, FlashRaw as FlashRawFile, PreviewDescriptor } from 'flashraw';
import simdWasm from 'flashraw/wasm/simd?url';
import fallbackWasm from 'flashraw/wasm/fallback?url';
import threadsWasm from 'flashraw/wasm/threads?url';
import simdJxlWasm from 'flashraw/wasm/simd-jxl?url';
import threadsJxlWasm from 'flashraw/wasm/threads-jxl?url';
import threadWorkerUrl from 'flashraw/thread-worker?worker&url';

type FlashRawModule = typeof FlashRawNamespace;

/** Threads per decode when the page is cross-origin isolated (4 gave 3.2× on a 24 MP CR3; 8 only 3.6×). */
export const MAX_THREADS = 4;

let loaded: Promise<FlashRawModule> | undefined;

function threadCount(): number {
  if (globalThis.crossOriginIsolated !== true || typeof SharedArrayBuffer !== 'function') return 0;
  const cores = globalThis.navigator?.hardwareConcurrency ?? 1;
  return Math.max(0, Math.min(cores, MAX_THREADS));
}

async function load(): Promise<FlashRawModule> {
  const fr = await import('flashraw');
  const threads = threadCount();
  if (threads > 1) {
    try {
      await fr.init({ threads, wasm: threadsWasm, jpegxlWasm: threadsJxlWasm, threadWorkerUrl });
      return fr;
    } catch {
      // Threads couldn't start (e.g. a browser without nested workers): one thread it is.
    }
  }
  const simd = fr.simdSupported();
  await fr.reinit({
    threads: false,
    simd,
    wasm: simd ? simdWasm : fallbackWasm,
    ...(simd ? { jpegxlWasm: simdJxlWasm } : {}),
  });
  return fr;
}

export function loadFlashRaw(): Promise<FlashRawModule> {
  loaded ??= load().catch((error: unknown) => {
    loaded = undefined; // allow a retry, e.g. after a failed download
    throw error;
  });
  return loaded;
}

export type { DecodedFrame, FlashRawFile, PreviewDescriptor };
