// Test switch (P12b): import this first in a worker to make it look like a browser without
// OffscreenCanvas in workers (Safari before 16.4, Playwright's WebKit on Windows). The image
// engine then picks its canvas-free decoders, exactly as it would there. Not app code.
(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined;

export {};
