// The image worker: runs the image pipeline off the main thread. Created by the job queue
// (`image` job kind, found by src/core/queue/registry.ts at exactly this path) and driven through
// Comlink as a `WorkerApi`. The pipeline is imported on the first job, and inside it every codec,
// pica and libheif load on first use (D27), so the worker starts instantly.
import * as Comlink from 'comlink';
import type { WorkerApi } from '@/core/contracts';
import { pipelineStrings } from '@/engines/optimize/strings';

const api: WorkerApi = {
  async run(op, input, onProgress) {
    if (op !== 'process') throw new Error(pipelineStrings.unknownOp(op));
    const { isImageJobInput, processImage } = await import('./pipeline');
    if (!isImageJobInput(input)) throw new Error(pipelineStrings.badInput);
    return processImage(input, onProgress);
  },
};

Comlink.expose(api);
