/**
 * Safari and every iOS browser (all use WebKit). Works in pages and workers.
 *
 * Why it matters: since D43 Safari is cross-origin isolated, so multi-threaded WebAssembly is
 * allowed there, but it hasn't been tried on a real iPhone or Mac yet. As a precaution (D45),
 * WebKit encodes and develops RAW on one thread, as it did before D43, until that check.
 */
export function isWebKit(userAgent = globalThis.navigator?.userAgent ?? ''): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /AppleWebKit/.test(userAgent) && !/\b(Chrome|Chromium|CriOS|Edg|EdgiOS|FxiOS|OPR)\//.test(userAgent);
}

/** Multi-threaded WebAssembly is available and safe to use here. */
export function wasmThreadsAllowed(): boolean {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer === 'function' &&
    (globalThis.navigator?.hardwareConcurrency ?? 1) > 1 &&
    !isWebKit()
  );
}
