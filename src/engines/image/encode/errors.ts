import type { ImageFormat } from '@/core/contracts/image';

export type EncodeErrorCode = 'codec-unavailable' | 'too-large' | 'encode-failed' | 'bad-input';

/** Any failure in `encodeImage`. `message` is readable by users. */
export class ImageEncodeError extends Error {
  override readonly name: string = 'ImageEncodeError';
  constructor(
    readonly code: EncodeErrorCode,
    readonly format: ImageFormat,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * The codec's JavaScript or WebAssembly couldn't be loaded or started (old browser, blocked
 * WebAssembly, network failure while fetching the .wasm). The pipeline (P12) catches this,
 * falls back to another format and adds the `format-fallback` note.
 */
export class CodecUnavailableError extends ImageEncodeError {
  override readonly name: string = 'CodecUnavailableError';
  constructor(format: ImageFormat, message: string, options?: { cause?: unknown }) {
    super('codec-unavailable', format, message, options);
  }
}

export function isCodecUnavailable(e: unknown): e is CodecUnavailableError {
  return e instanceof ImageEncodeError && e.code === 'codec-unavailable';
}
