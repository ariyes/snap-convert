// M9 — job queue and worker pool (P04).
//
//   const add = useQueue((s) => s.add);
//   const ids = add('image', 'process', files.map((f) => ({ label: f.name, input })));
//   useQueue.getState().start();
//
// Jobs over 40 MP run alone when the input carries numeric `width` and `height`
// (e.g. copied from IntakeFile); jobs over 100 MB of Blobs/buffers always run alone.

import { WorkerPool } from './pool';
import { defaultRegistry } from './registry';
import { createQueueStore } from './store';

/** The app's queue. Workers are only created when the first job starts. */
export const useQueue = createQueueStore({
  pool: () => new WorkerPool({ registry: defaultRegistry }),
});

export { createQueueStore, PROGRESS_TICK_MS } from './store';
export type { QueueState, QueueStore, QueueStoreOptions } from './store';
export { WorkerPool, IDLE_TIMEOUT_MS } from './pool';
export type { PoolStats, RunOutcome, WorkerPoolOptions } from './pool';
export {
  availableKinds,
  defaultRegistry,
  moduleWorkerFactory,
  WORKER_MODULES,
  WorkerUnavailableError,
} from './registry';
export type { WorkerFactory, WorkerRegistry, WorkerUrlLoaders } from './registry';
export {
  computePoolSize,
  HEAVY_LIMITS,
  inputBytes,
  inputMegapixels,
  isHeavyInput,
  isPhoneLike,
  POOL_LIMITS,
  readDevice,
} from './device';
export type { DeviceInfo } from './device';
export { createEtaSmoother, ETA_MIN_FRACTION, rawEtaSeconds, runFraction } from './eta';
export { isOutOfMemoryError, jobErrorMessage } from './errors';
export { queueStrings } from './strings';
