// Keeps one queue job per file for the current settings (planJobs), and hands back each file's
// job. The queue is shared by every tool: this page only touches the jobs it added, and removes
// them all when it unmounts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import type { Job, JobStatus } from '@/core/contracts/queue';
import { useQueue } from '@/core/queue';
import { planJobs, type Entry } from './schedule';
import { jobInput, type JobOptions } from './settings';

export interface FileJob {
  jobId: string;
  status: JobStatus;
  progress: number;
  result?: ImageJobResult;
  error?: string;
}

export interface CompressJobs {
  /** Each file's job for the current settings key (files without one are missing). */
  byFile: ReadonlyMap<string, FileJob>;
  /** Run a failed file again. */
  retry: (fileId: string) => void;
}

/** Narrows a queue result to what the image worker returns. */
export function isImageResult(value: unknown): value is ImageJobResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'blob' in value &&
    value.blob instanceof Blob &&
    'bytes' in value &&
    typeof value.bytes === 'number'
  );
}

interface EntriesState {
  entries: Entry[];
  seq: number;
}

export function useCompressJobs(
  files: readonly IntakeFile[],
  selectedId: string | null,
  options: JobOptions,
  key: string,
): CompressJobs {
  // The jobs this page added, in a small store of its own (written from effects, read in render).
  const [store] = useState(() => createStore<EntriesState>(() => ({ entries: [], seq: 0 })));
  const entries = useStore(store, (s) => s.entries);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const jobs = useQueue((s) => s.jobs);
  const mine = useMemo(() => {
    const ids = new Set(entries.map((e) => e.jobId));
    return jobs.filter((j) => ids.has(j.id));
  }, [jobs, entries]);
  // The plan only changes when one of this page's jobs changes status.
  const signature = mine.map((j) => `${j.id}:${j.status}`).join(',');

  useEffect(() => {
    const queue = useQueue.getState();
    const byId = new Map<string, Job>(queue.jobs.map((j) => [j.id, j]));
    const status = (id: string) => byId.get(id)?.status;
    const { entries: current } = store.getState();
    const plan = planJobs({
      fileIds: files.map((f) => f.id),
      selectedId,
      key,
      entries: current,
      status,
    });

    const removed = new Set(plan.remove);
    const readded = new Set(plan.add);
    const kept = current.filter(
      (e) => !removed.has(e.jobId) && status(e.jobId) !== undefined && !readded.has(e.fileId),
    );
    for (const id of plan.remove) queue.remove(id);

    const byFile = new Map(files.map((f) => [f.id, f]));
    const adding = plan.add.flatMap((id) => {
      const file = byFile.get(id);
      return file ? [file] : [];
    });
    let seq = store.getState().seq;
    if (adding.length > 0) {
      const ids = queue.add(
        'image',
        'process',
        adding.map((f) => ({ label: f.name, input: jobInput(f, optionsRef.current) })),
      );
      adding.forEach((f, i) => {
        const jobId = ids[i];
        if (jobId) kept.push({ fileId: f.id, jobId, key, seq: ++seq });
      });
    }
    if (kept.length !== current.length || adding.length > 0) store.setState({ entries: kept, seq });
    if (adding.length > 0) queue.start();
  }, [store, files, selectedId, key, signature]);

  // Leaving the page: stop and drop this page's jobs (their results go with them).
  useEffect(
    () => () => {
      const queue = useQueue.getState();
      for (const e of store.getState().entries) queue.remove(e.jobId);
      store.setState({ entries: [] });
    },
    [store],
  );

  const byFile = useMemo(() => {
    const map = new Map<string, FileJob>();
    const byId = new Map(mine.map((j) => [j.id, j]));
    for (const e of entries) {
      if (e.key !== key) continue;
      const job = byId.get(e.jobId);
      if (!job) continue;
      map.set(e.fileId, {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        result: isImageResult(job.result) ? job.result : undefined,
        error: job.error,
      });
    }
    return map;
  }, [mine, entries, key]);

  const retry = (fileId: string) => {
    const job = byFile.get(fileId);
    if (job) useQueue.getState().retry(job.jobId);
  };

  return { byFile, retry };
}
