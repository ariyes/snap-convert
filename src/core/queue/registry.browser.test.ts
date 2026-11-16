// The registry's loading mechanism (import.meta.glob + ?worker&url + module Worker) with the fake worker.

import * as Comlink from 'comlink';
import { describe, expect, it } from 'vitest';
import type { WorkerApi } from '@/core/contracts';
import {
  availableKinds,
  defaultRegistry,
  moduleWorkerFactory,
  WORKER_MODULES,
  WorkerUnavailableError,
} from './registry';

const testWorkerUrls = import.meta.glob<string>('./test-worker.ts', {
  query: '?worker&url',
  import: 'default',
});

describe('worker registry', () => {
  it('starts a module worker from a glob entry and talks to it through Comlink', async () => {
    const factory = moduleWorkerFactory(testWorkerUrls, './test-worker.ts', 'test');
    const worker = await factory();
    try {
      const api = Comlink.wrap<WorkerApi>(worker);
      const progress: number[] = [];
      const result = await api.run(
        'work',
        { ms: 30, steps: 3, value: 'hi' },
        Comlink.proxy((p: number) => {
          progress.push(p);
        }),
      );
      expect(result).toMatchObject({ value: 'hi' });
      expect(progress.at(-1)).toBe(1);
    } finally {
      worker.terminate();
    }
  });

  it('reports a missing worker module as unavailable', async () => {
    const factory = moduleWorkerFactory(testWorkerUrls, './missing-worker.ts', 'missing');
    await expect(Promise.resolve().then(factory)).rejects.toBeInstanceOf(WorkerUnavailableError);
  });

  it('has a factory for every job kind, pointing at the engine workers', () => {
    expect(Object.keys(defaultRegistry).sort()).toEqual(['image', 'pdf']);
    expect(WORKER_MODULES).toEqual({
      image: '../../engines/image/worker.ts',
      pdf: '../../engines/pdf/worker.ts',
    });
    // Only kinds whose worker file exists in this build (P07 / P12 add them).
    for (const kind of availableKinds()) expect(['image', 'pdf']).toContain(kind);
  });
});
