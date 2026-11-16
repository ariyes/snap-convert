/**
 * Test-only worker (P06): runs the real encoders and quality tools inside a Web Worker, the way
 * the image worker (P12) will. Browser tests talk to it through Comlink. Not part of the app.
 */
import { expose } from 'comlink';
import type { EncodeOptions } from '@/core/contracts/image';
import { applyMetadataDetailed } from '../../metadata/apply';
import type { ImageMetadata, MetadataPolicy } from '@/core/contracts/image';
import { isGraphic, ssim } from '../../quality';
import { encodeImage, type EncodeHints } from '../encode';
import { avifOptions, chooseChroma, clampQuality } from '../options';
import { canUseThreads, loadCodec } from '../codecs';

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
  /** Raw AVIF encode at an explicit libavif quality, for tuning the quality mapping. */
  async avifRaw(img: ImageData, avifQ: number, graphic: boolean) {
    const encode = await loadCodec('avif');
    const o = avifOptions(80, chooseChroma(clampQuality(80), graphic), img.width * img.height, canUseThreads());
    const t0 = performance.now();
    const bytes = await encode(img, { ...o, quality: avifQ });
    return { blob: new Blob([bytes], { type: 'image/avif' }), ms: performance.now() - t0 };
  },
  /** Raw codec call with explicit options, for tuning. */
  async raw(format: 'jpeg' | 'webp' | 'avif', img: ImageData, o: Record<string, number | boolean>) {
    const encode = (await loadCodec(format)) as (i: ImageData, o: object) => Promise<ArrayBuffer>;
    const t0 = performance.now();
    const bytes = await encode(img, o);
    return { blob: new Blob([bytes], { type: `image/${format}` }), ms: performance.now() - t0 };
  },
  ssim(a: ImageData, b: ImageData) {
    const t0 = performance.now();
    const score = ssim(a, b);
    return { score, ms: performance.now() - t0 };
  },
  isGraphic(img: ImageData) {
    return isGraphic(img);
  },
  async applyMetadata(blob: Blob, meta: ImageMetadata, policy: MetadataPolicy) {
    return applyMetadataDetailed(blob, meta, policy);
  },
  environment() {
    return { threads: canUseThreads(), crossOriginIsolated: globalThis.crossOriginIsolated };
  },
};

export type HarnessApi = typeof api;

expose(api);
