// HEIC / HEIF decoding with libheif-js, loaded only when a HEIC file needs it
// (about 2 MB of WebAssembly that must never be in the startup bundle).

import type { LibHeif } from 'libheif-js/libheif-wasm/libheif-bundle.mjs';

let lib: Promise<LibHeif> | undefined;

function loadLibheif(): Promise<LibHeif> {
  lib ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs')
    .then((m) => m.default())
    .catch((error: unknown) => {
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
