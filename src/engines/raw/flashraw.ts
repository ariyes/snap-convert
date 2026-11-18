// FlashRaw (MIT/Apache-2.0, D40), the primary RAW decoder. Runs only inside the RAW worker.
// Its .wasm files are our own static assets (same origin, no user data sent), passed explicitly so
// the dev server's dependency pre-bundling can't break FlashRaw's own `new URL(…)` lookups.
// The multithreaded build is used only when the page is cross-origin isolated (D43), with at most
// four threads; everything works single-threaded.

import { wasmThreadsAllowed } from '@/lib/webkit';
import type * as FlashRawNamespace from 'flashraw';
import type { DecodedFrame, FlashRaw as FlashRawFile, PreviewDescriptor } from 'flashraw';
import simdWasm from 'flashraw/wasm/simd?url';
import fallbackWasm from 'flashraw/wasm/fallback?url';
import threadsWasm from 'flashraw/wasm/threads?url';
import simdJxlWasm from 'flashraw/wasm/simd-jxl?url';
import threadsJxlWasm from 'flashraw/wasm/threads-jxl?url';
import threadWorkerUrl from 'flashraw/thread-worker?worker&url';
import { absoluteUrl, bootstrapWorkerUrl } from './worker-url';

type FlashRawModule = typeof FlashRawNamespace;

/** Threads per decode when the page is cross-origin isolated (4 gave 3.2× on a 24 MP CR3; 8 only 3.6×). */
export const MAX_THREADS = 4;

let loaded: Promise<FlashRawModule> | undefined;

function threadCount(): number {
  // One thread on WebKit until threads are proven on real Safari (src/lib/webkit.ts).
  if (!wasmThreadsAllowed()) return 0;
  const cores = globalThis.navigator?.hardwareConcurrency ?? 1;
  return Math.max(0, Math.min(cores, MAX_THREADS));
}

/** How the last load went (tests and diagnostics): threads, and whether they needed the blob start. */
export interface FlashRawLoadInfo {
  threads: number;
  threadStart?: 'direct' | 'blob';
}
let loadInfo: FlashRawLoadInfo = { threads: 0 };
export const flashRawLoadInfo = (): FlashRawLoadInfo => ({ ...loadInfo });

async function load(): Promise<FlashRawModule> {
  const fr = await import('flashraw');
  // Absolute URLs: this worker may run from a blob: URL (worker-url.ts), where root-relative
  // asset paths can't be resolved.
  const threads = threadCount();
  if (threads > 1) {
    // Thread workers are nested workers: start them from their URL, else from a blob that imports it.
    for (const start of ['direct', 'blob'] as const) {
      const workerUrl =
        start === 'direct' ? absoluteUrl(threadWorkerUrl) : bootstrapWorkerUrl(threadWorkerUrl);
      try {
        await fr.reinit({
          threads,
          wasm: absoluteUrl(threadsWasm),
          jpegxlWasm: absoluteUrl(threadsJxlWasm),
          threadWorkerUrl: workerUrl,
        });
        // The blob URL stays valid: the pool may start more threads later.
        loadInfo = { threads, threadStart: start };
        return fr;
      } catch {
        if (start === 'blob') URL.revokeObjectURL(workerUrl);
        // Threads couldn't start this way: try the next, then one thread.
      }
    }
  }
  const simd = fr.simdSupported();
  await fr.reinit({
    threads: false,
    simd,
    wasm: absoluteUrl(simd ? simdWasm : fallbackWasm),
    ...(simd ? { jpegxlWasm: absoluteUrl(simdJxlWasm) } : {}),
  });
  loadInfo = { threads: 0 };
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
