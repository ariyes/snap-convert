// Types for the parts of libheif-js we use (the package ships no types for its browser build).
declare module 'libheif-js/libheif-wasm/libheif.js' {
  export interface HeifDisplayTarget {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    has_alpha_channel(): boolean;
    /** Decodes into `target.data` as interleaved RGBA; calls back with `target`, or `null` on failure. */
    display(target: HeifDisplayTarget, callback: (result: HeifDisplayTarget | null) => void): void;
    free(): void;
  }
  export interface HeifDecoder {
    /** The libheif context of the last decode (freed by the next decode). */
    decoder: unknown;
    decode(data: Uint8Array): HeifImage[];
  }
  export interface LibHeif {
    HeifDecoder: new () => HeifDecoder;
    heif_context_free(context: unknown): void;
  }
  export interface LibHeifOptions {
    /** The libheif.wasm bytes (the package's .wasm file, served as our own asset). */
    wasmBinary?: ArrayBuffer;
    onRuntimeInitialized?: () => void;
    onAbort?: (reason: unknown) => void;
  }
  /** Emscripten module factory; returns the module object (usable once the runtime is initialised). */
  export default function libheif(options?: LibHeifOptions): LibHeif;
}
