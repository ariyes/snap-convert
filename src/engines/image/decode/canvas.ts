// Can this worker read decoded pixels through a canvas? Workers in Safari before 16.4 (and
// Playwright's WebKit on Windows) have no OffscreenCanvas; there every format is decoded with
// WebAssembly or the pure-TypeScript decoders instead. Checked once per worker.

let available: boolean | undefined;

/**
 * True when `createImageBitmap` and a 2D `OffscreenCanvas` work here (the fast path: the
 * browser's own decoders). False selects the canvas-free decoders for the rest of this worker's life.
 */
export function canvasAvailable(): boolean {
  available ??= probe();
  return available;
}

function probe(): boolean {
  try {
    if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
      return false;
    }
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.getImageData !== 'function') return false;
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}
