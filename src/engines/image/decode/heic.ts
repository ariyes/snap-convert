// HEIC / HEIF decoding with libheif-js, loaded only when a HEIC file needs it
// (90 KB of JavaScript plus a 1.4 MB WebAssembly file that must never be in the startup bundle).
// The .wasm is our own static asset (same origin; no user data is sent), fetched and handed to
// libheif as bytes. We use this build rather than libheif-js's 2 MB "bundle" (WebAssembly inlined
// as base64 text): smaller download, and loading that bundle stalled other work in the page.

import type { LibHeif } from 'libheif-js/libheif-wasm/libheif.js';
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';

let lib: Promise<LibHeif> | undefined;

async function createLibheif(): Promise<LibHeif> {
  const [{ default: factory }, response] = await Promise.all([
    import('libheif-js/libheif-wasm/libheif.js'),
    fetch(wasmUrl),
  ]);
  if (!response.ok) throw new Error(`libheif.wasm: HTTP ${response.status}`);
  const wasmBinary = await response.arrayBuffer();
  return new Promise<LibHeif>((resolve, reject) => {
    let module: LibHeif | undefined = undefined;
    module = factory({
      wasmBinary,
      // May run inside factory() before `module` is assigned, so resolve on the next microtask.
      onRuntimeInitialized: () =>
        queueMicrotask(() =>
          module ? resolve(module) : reject(new Error('libheif failed to start')),
        ),
      onAbort: (reason) => reject(new Error(String(reason))),
    });
  });
}

function loadLibheif(): Promise<LibHeif> {
  lib ??= createLibheif().catch((error: unknown) => {
    lib = undefined; // allow a retry, e.g. after a failed chunk download
    throw error;
  });
  return lib;
}

/**
 * Decodes the primary image (the one a photo viewer shows; falls back to the first image)
 * as RGBA. libheif applies the file's rotation and mirroring itself.
 * Returns `undefined` if libheif can't read the file.
 */
export async function decodeHeic(bytes: Uint8Array): Promise<ImageData | undefined> {
  const libheif = await loadLibheif();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(bytes);
  try {
    const image = images.find((i) => i.is_primary()) ?? images[0];
    if (!image) return undefined;
    const width = image.get_width();
    const height = image.get_height();
    if (!(width > 0 && height > 0)) return undefined;
    const pixels = new ImageData(width, height);
    const ok = await new Promise<boolean>((resolve) => {
      image.display({ data: pixels.data, width, height }, (result) => resolve(result !== null));
    });
    return ok ? pixels : undefined;
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
  }
}
