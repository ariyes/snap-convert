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
import { wasmThreadsAllowed } from '@/lib/webkit';
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
  png: async () =>
    wasmThreadsAllowed()
      ? (await import('@jsquash/oxipng/optimise.js')).default
      : singleThreadPng(),
  webp: async () => (await import('@jsquash/webp/encode.js')).default,
  avif: async () =>
    wasmThreadsAllowed() ? (await import('@jsquash/avif/encode.js')).default : singleThreadAvif(),
};

/**
 * jSquash's AVIF encoder picks its multi-threaded build by itself whenever threads exist. Where we
 * don't want threads (WebKit, see src/lib/webkit.ts) this loads the single-threaded build directly
 * and calls it the way jSquash's encode() does (we never use lossless AVIF).
 */
async function singleThreadAvif(): Promise<Codecs['avif']> {
  const [codec, utils, meta] = (await Promise.all([
    import('@jsquash/avif/codec/enc/avif_enc.js'),
    import('@jsquash/avif/utils.js'),
    import('@jsquash/avif/meta.js'),
  ])) as unknown as [AvifCodecModule, AvifUtilsModule, AvifMetaModule];
  const module = utils.initEmscriptenModule(codec.default);
  return async (img, options) => {
    const encoder = await module;
    const output = encoder.encode(new Uint8Array(img.data.buffer), img.width, img.height, {
      ...meta.defaultOptions,
      ...options,
    });
    if (!output) throw new Error('Encoding error.');
    return output.buffer as ArrayBuffer;
  };
}

/**
 * Same for oxipng: jSquash starts its wasm-bindgen-rayon thread pool whenever threads exist. In
 * WebKit, once the page is cross-origin isolated (D43), that pool hung jobs under load (3 of 4
 * parallel runs of the format matrix; 4 of 4 passed without isolation). WebKit uses the
 * single-threaded build, called the way jSquash's optimise() does.
 */
async function singleThreadPng(): Promise<Codecs['png']> {
  const [codec, meta] = (await Promise.all([
    import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js'),
    import('@jsquash/oxipng/meta.js'),
  ])) as unknown as [OxipngCodecModule, OxipngMetaModule];
  await codec.default();
  return (img, options) => {
    const o = { ...meta.defaultOptions, ...options };
    return Promise.resolve(
      codec.optimise_raw(img.data, img.width, img.height, o.level, o.interlace, o.optimiseAlpha)
        .buffer as ArrayBuffer,
    );
  };
}

interface OxipngCodecModule {
  default(): Promise<unknown>;
  optimise_raw(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    level: number,
    interlace: boolean,
    optimiseAlpha: boolean,
  ): Uint8Array;
}
interface OxipngMetaModule {
  defaultOptions: { level: number; interlace: boolean; optimiseAlpha: boolean };
}

/** The parts of jSquash's AVIF internals used above (its own files are plain JS to the linter). */
interface AvifEncoderInstance {
  encode(data: Uint8Array, width: number, height: number, options: object): Uint8Array | null;
}
interface AvifCodecModule {
  default: unknown;
}
interface AvifUtilsModule {
  initEmscriptenModule(factory: unknown): Promise<AvifEncoderInstance>;
}
interface AvifMetaModule {
  defaultOptions: object;
}

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
        await encode(probe, {});
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

/** True when the AVIF encoder uses its multi-threaded build (cross-origin isolated, not WebKit). */
export function canUseThreads(): boolean {
  return wasmThreadsAllowed();
}
