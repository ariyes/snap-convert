// Some browsers can't fetch the script of a worker started from inside another worker (seen in
// the Claude desktop app's Chromium 156 browser: "An unknown error occurred when fetching the
// script", for every same-origin worker URL), although module imports from workers load fine.
// The RAW worker (started by the image worker) and FlashRaw's thread workers (started by the RAW
// worker) are both nested, so when a worker can't start from its URL it is started from a tiny
// blob: module that imports the real script instead. The blob inherits the page's origin and
// cross-origin isolation; the app's CSP allows `worker-src 'self' blob:`.

/** Absolute form of a URL from a `?url` / `?worker&url` import (those are root-relative). */
export function absoluteUrl(url: string | URL, base: string = import.meta.url): string {
  return new URL(url, base).href;
}

/** A blob: URL of a module worker script that only imports `url`. Revoke it once the worker runs. */
export function bootstrapWorkerUrl(url: string | URL): string {
  const source = `import ${JSON.stringify(absoluteUrl(url))};\n`;
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}
