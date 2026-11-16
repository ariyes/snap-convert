/**
 * Lazy codec loading. Each jSquash encoder is pulled in with a dynamic import() the first time
 * its format is used, so none of them are in the startup bundle. The packages find their .wasm
 * with `new URL('x.wasm', import.meta.url)`, which Vite turns into emitted assets served from our
 * own build (never a CDN). vite.config.ts keeps them out of dependency pre-bundling for this.
 */
import type { ImageFormat } from '@/core/contracts/image';
import type { EncodeOptions as MozJpegEncodeOptions } from '@jsquash/jpeg/meta.js';
import type { OptimiseOptions } from '@jsquash/oxipng/meta.js';
import type { EncodeOptions as WebpEncodeOptions } from '@jsquash/webp/meta.js';
import { CodecUnavailableError } from './errors';
import type { AvifOptions } from './options';
import { encodeStrings } from './strings';

export interface Codecs {
  jpeg: (img: ImageData, o: Partial<MozJpegEncodeOptions>) => Promise<ArrayBuffer>;
  png: (img: ImageData, o: Partial<OptimiseOptions>) => Promise<ArrayBuffer>;
  webp: (img: ImageData, o: Partial<WebpEncodeOptions>) => Promise<ArrayBuffer>;
  avif: (img: ImageData, o: AvifOptions) => Promise<ArrayBuffer>;
}

const importers: { [F in ImageFormat]: () => Promise<Codecs[F]> } = {
  jpeg: async () => (await import('@jsquash/jpeg/encode.js')).default,
  png: async () => (await import('@jsquash/oxipng/optimise.js')).default,
  webp: async () => (await import('@jsquash/webp/encode.js')).default,
  avif: async () => (await import('@jsquash/avif/encode.js')).default,
};

const loaded = new Map<ImageFormat, Promise<unknown>>();

/**
 * Loads (once) and returns the encoder for `format`. A 1×1 test encode makes sure the
 * WebAssembly actually started; any failure becomes a `CodecUnavailableError`. Failures are
 * not cached, so a later call tries again.
 */
export function loadCodec<F extends ImageFormat>(format: F): Promise<Codecs[F]> {
  let p = loaded.get(format) as Promise<Codecs[F]> | undefined;
  if (!p) {
    p = (async () => {
      try {
        const encode = await importers[format]();
        const probe = new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1);
        await (encode as (img: ImageData, o: object) => Promise<ArrayBuffer>)(probe, {});
        return encode;
      } catch (cause) {
        loaded.delete(format);
        throw new CodecUnavailableError(format, encodeStrings.codecUnavailable(format), { cause });
      }
    })();
    loaded.set(format, p);
  }
  return p;
}

/** True when the AVIF encoder can use its multi-threaded build (needs cross-origin isolation). */
export function canUseThreads(): boolean {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer === 'function' &&
    (globalThis.navigator?.hardwareConcurrency ?? 1) > 1
  );
}
