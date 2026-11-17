// Test worker (P24b): runs the image pipeline with the sampled quality guard forced on or off,
// so the quality report can check that guarding on a sample picks the same quality as guarding at
// full size. With `canvas: false` it runs canvas-free, as older Safari (P12b). Not app code.
import * as Comlink from 'comlink';
import type { ImageJobInput, ImageJobResult } from '@/core/contracts/image';
import type { processImage as ProcessImage } from '@/engines/image/pipeline';
import type { GuardSampleMode } from '@/engines/optimize/sample';

export interface GuardSampleWorkerApi {
  run(input: ImageJobInput, mode: GuardSampleMode, canvas: boolean): Promise<ImageJobResult>;
}

let started: Promise<{ processImage: typeof ProcessImage }> | undefined;

const api: GuardSampleWorkerApi = {
  async run(input, mode, canvas) {
    started ??= (async () => {
      // Switched off before the engine loads, as in the app's no-canvas test worker.
      if (!canvas) await import('@/engines/image/testing/no-canvas');
      return import('@/engines/image/pipeline');
    })();
    const { processImage } = await started;
    return processImage(input, undefined, { guardSample: mode });
  },
};

Comlink.expose(api);
