import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodecUnavailableError, isCodecUnavailable } from './errors';

// Simulates a browser where the AVIF WebAssembly can't start (blocked, too old, fetch failed).
vi.mock('@jsquash/avif/encode.js', () => ({
  default: () => Promise.reject(new Error('WebAssembly.instantiate(): blocked')),
}));

describe('loadCodec', () => {
  beforeEach(() => {
    if (typeof ImageData === 'undefined') {
      vi.stubGlobal(
        'ImageData',
        class {
          constructor(
            readonly data: Uint8ClampedArray,
            readonly width: number,
            readonly height: number,
          ) {}
        },
      );
    }
  });
  afterEach(() => vi.unstubAllGlobals());

  it('turns a codec that fails to start into a typed CodecUnavailableError', async () => {
    const { loadCodec } = await import('./codecs');
    const error: unknown = await loadCodec('avif').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodecUnavailableError);
    expect(isCodecUnavailable(error)).toBe(true);
    expect(error).toMatchObject({ code: 'codec-unavailable', format: 'avif' });
    expect((error as Error).message).toBe("Your browser couldn't load the AVIF encoder.");
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it('does not cache the failure, so a later call tries again', async () => {
    const { loadCodec } = await import('./codecs');
    const first = loadCodec('avif');
    await first.catch(() => undefined);
    const second = loadCodec('avif');
    expect(second).not.toBe(first);
    await expect(second).rejects.toBeInstanceOf(CodecUnavailableError);
  });
});
