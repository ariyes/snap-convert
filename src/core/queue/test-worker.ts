// Fake worker for the queue's browser tests. Not part of the app.
//
// Ops:
//   work   { ms, steps?, value? }  reports progress `steps` times over `ms`, returns { workerId, value }
//   throw  { message }             throws an Error
//   throw-value                     throws something that isn't an Error
//   oom                             throws the RangeError an ArrayBuffer allocation gives when memory runs out
//   crash  { ms? }                  an uncaught error after `ms` (the worker's error event); never returns
//   echo                            returns { workerId, value: input }

import * as Comlink from 'comlink';
import type { WorkerApi } from '@/core/contracts';

/** Different for every worker instance, so tests can see reuse and replacement. */
const workerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

interface WorkInput {
  ms?: number;
  steps?: number;
  value?: unknown;
  message?: string;
}

function asWorkInput(input: unknown): WorkInput {
  return typeof input === 'object' && input !== null ? input : {};
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const api: WorkerApi = {
  async run(op, input, onProgress) {
    const o = asWorkInput(input);
    switch (op) {
      case 'work': {
        const ms = o.ms ?? 50;
        const steps = Math.max(1, o.steps ?? 10);
        const start = performance.now();
        for (let i = 1; i <= steps; i++) {
          const due = start + (ms * i) / steps;
          await wait(Math.max(0, due - performance.now()));
          onProgress(i / steps);
        }
        return { workerId, value: o.value };
      }
      case 'throw':
        throw new Error(o.message ?? 'Fake failure');
      case 'throw-value':
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- testing a non-Error throw
        throw 42;
      case 'oom':
        throw new RangeError('Array buffer allocation failed');
      case 'crash':
        setTimeout(() => {
          throw new Error('Fake crash');
        }, o.ms ?? 10);
        return new Promise<never>(() => undefined);
      case 'echo':
        return { workerId, value: input };
      default:
        throw new Error(`Unknown op ${op}`);
    }
  },
};

Comlink.expose(api);
