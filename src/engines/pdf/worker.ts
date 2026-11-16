// The PDF worker: runs pdf-lib operations off the main thread. Created by the job queue
// (`pdf` job kind) and driven through Comlink as a `WorkerApi`. pdf-lib is imported only here
// (through ./ops/run), so it never lands in the startup bundle.
import * as Comlink from 'comlink';
import type { WorkerApi } from '@/core/contracts';
import { runPdfOp } from './ops/run';

const api: WorkerApi = {
  run(op, input, onProgress) {
    return runPdfOp(op, input, onProgress);
  },
};

Comlink.expose(api);
