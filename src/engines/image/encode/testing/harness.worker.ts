/**
 * Test-only worker (P06): runs the real encoders and quality tools inside a Web Worker, the way
 * the image worker (P12) will. Browser tests talk to it through Comlink. Not part of the app.
 */
import { expose } from 'comlink';
import type { EncodeOptions, ImageMetadata, MetadataPolicy } from '@/core/contracts/image';
import { applyMetadataDetailed } from '../../metadata/apply';
import { isGraphic, ssim } from '../../quality';
import { canUseThreads } from '../codecs';
import { encodeImage, type EncodeHints } from '../encode';

const api = {
  async encode(img: ImageData, o: EncodeOptions, hints?: EncodeHints) {
    const t0 = performance.now();
    const blob = await encodeImage(img, o, hints);
    return { blob, ms: performance.now() - t0 };
  },
  /** Error name, code and message, for asserting typed errors across the worker boundary. */
  async encodeError(img: ImageData, o: EncodeOptions) {
    try {
      await encodeImage(img, o);
      return null;
    } catch (e) {
      const err = e as Error & { code?: string };
      return { name: err.name, code: err.code, message: err.message };
    }
  },
  ssim(a: ImageData, b: ImageData) {
    const t0 = performance.now();
    const score = ssim(a, b);
    return { score, ms: performance.now() - t0 };
  },
  isGraphic(img: ImageData) {
    const t0 = performance.now();
    const graphic = isGraphic(img);
    return { graphic, ms: performance.now() - t0 };
  },
  applyMetadata(blob: Blob, meta: ImageMetadata, policy: MetadataPolicy) {
    return applyMetadataDetailed(blob, meta, policy);
  },
  environment() {
    return { threads: canUseThreads(), crossOriginIsolated: globalThis.crossOriginIsolated };
  },
};

export type HarnessApi = typeof api;

expose(api);
