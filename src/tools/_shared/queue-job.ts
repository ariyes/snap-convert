// Runs one job on the shared queue and waits for it (Images to PDF, Compress). The queue is shared
// by every tool, so a page only ever touches the jobs it added, and removes each one as soon as it
// has finished (the result is kept by the caller).

import type { Job, JobKind } from '@/core/contracts/queue';
import type { QueueState } from '@/core/queue';

/** The part of the queue store a job needs (the real one is `useQueue`). */
export interface QueueLike {
  getState(): Pick<QueueState, 'jobs' | 'add' | 'start' | 'cancel' | 'remove'>;
  subscribe(listener: (state: Pick<QueueState, 'jobs'>) => void): () => void;
}

/** The job was cancelled (or taken off the queue) before it finished. */
export class JobCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'JobCancelled';
  }
}

export interface QueuedJob<R> {
  id: string;
  /** Resolves with the result, rejects with the job's user-readable error or `JobCancelled`. */
  done: Promise<R>;
}

export function runQueued<I, R>(
  queue: QueueLike,
  kind: JobKind,
  op: string,
  label: string,
  input: I,
  onProgress?: (p: number) => void,
): QueuedJob<R> {
  const api = queue.getState();
  const [id] = api.add(kind, op, [{ label, input }]);
  if (id === undefined) return { id: '', done: Promise.reject(new JobCancelled()) };

  const done = new Promise<R>((resolve, reject) => {
    let lastProgress = -1;
    let finished = false;
    const check = (jobs: readonly Job[]): void => {
      if (finished) return;
      const job = jobs.find((j) => j.id === id);
      if (!job) {
        finish(() => reject(new JobCancelled()), false);
        return;
      }
      if (job.progress !== lastProgress) {
        lastProgress = job.progress;
        onProgress?.(job.progress);
      }
      if (job.status === 'done') finish(() => resolve(job.result as R));
      else if (job.status === 'failed') finish(() => reject(new Error(job.error ?? '')));
      else if (job.status === 'cancelled') finish(() => reject(new JobCancelled()));
    };
    const finish = (settle: () => void, removeJob = true): void => {
      finished = true;
      unsubscribe();
      if (removeJob) queue.getState().remove(id);
      settle();
    };
    const unsubscribe = queue.subscribe((state) => check(state.jobs));
    check(queue.getState().jobs);
  });

  api.start();
  return { id, done };
}
