// Keeps one image job per file on the shared queue, for the current settings. Files added get a job
// straight away (one click: drop, then download); a new destination or format runs them all again.
// The queue is shared by all tools, so this page only ever touches the job ids it added.
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import type { Job } from '@/core/contracts/queue';
import { useQueue } from '@/core/queue';
import { track } from '@/lib/analytics';
import { optimizeJobInput, settingsKey, TOOL_ID, type OptimizeSettings } from './settings';

export type OptimizeJob = Job<unknown, ImageJobResult>;

interface RunState {
  /** settingsKey() the jobs were made with. */
  key: string | null;
  /** File id → job id. */
  jobIds: Record<string, string>;
}

/** This page's jobs. Outside React state so the shared queue and the page agree after a remount. */
export const useRunStore = create<RunState>(() => ({ key: null, jobIds: {} }));

function removeJobs(ids: Iterable<string>): void {
  const queue = useQueue.getState();
  for (const id of ids) queue.remove(id);
}

/** Matches the page's jobs to its files and settings: adds missing jobs, drops stale ones. */
export function syncJobs(files: readonly IntakeFile[], settings: OptimizeSettings): void {
  const key = settingsKey(settings);
  const state = useRunStore.getState();
  let jobIds = state.jobIds;

  if (state.key !== key) {
    removeJobs(Object.values(jobIds));
    jobIds = {};
  }

  const present = new Set(files.map((f) => f.id));
  const kept: Record<string, string> = {};
  const gone: string[] = [];
  for (const [fileId, jobId] of Object.entries(jobIds)) {
    if (present.has(fileId)) kept[fileId] = jobId;
    else gone.push(jobId);
  }
  removeJobs(gone);

  const missing = files.filter((f) => kept[f.id] === undefined);
  if (missing.length > 0) {
    const queue = useQueue.getState();
    const ids = queue.add(
      'image',
      'process',
      missing.map((f) => ({ label: f.name, input: optimizeJobInput(f, settings) })),
    );
    missing.forEach((f, i) => {
      const id = ids[i];
      if (id !== undefined) kept[f.id] = id;
    });
    queue.start();
    track({ name: 'tool-run', tool: TOOL_ID, files: missing.length });
  }

  useRunStore.setState({ key, jobIds: kept });
}

/** Removes every job of this page from the queue (page left or cleared). */
export function dropAllJobs(): void {
  removeJobs(Object.values(useRunStore.getState().jobIds));
  useRunStore.setState({ key: null, jobIds: {} });
}

/** The job of each file (by file id), kept in step with the files and settings. */
export function useOptimizeRun(
  files: readonly IntakeFile[],
  settings: OptimizeSettings,
): ReadonlyMap<string, OptimizeJob> {
  const { destination, format } = settings;
  useEffect(() => {
    syncJobs(files, { destination, format });
  }, [files, destination, format]);

  // Leaving the page stops its work and frees the results.
  useEffect(() => dropAllJobs, []);

  const jobIds = useRunStore((s) => s.jobIds);
  const jobs = useQueue((s) => s.jobs);
  return useMemo(() => {
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const out = new Map<string, OptimizeJob>();
    for (const [fileId, jobId] of Object.entries(jobIds)) {
      const job = byId.get(jobId);
      if (job) out.set(fileId, job as OptimizeJob);
    }
    return out;
  }, [jobIds, jobs]);
}
