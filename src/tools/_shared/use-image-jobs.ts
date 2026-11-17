// Keeps one image job per file in the shared queue, made with the current settings.
// Files added → queued at once; settings changed → re-queued after a short pause; file removed or
// page left → its job is removed. Only this tool's jobs are read back (the queue is shared, D21).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageJobInput, ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import type { Job } from '@/core/contracts/queue';
import { useQueue } from '@/core/queue';
import { planJobs, type JobEntry } from './job-plan';

/** Everything an image job needs except the file itself. */
export type ImageJobOptions = Omit<ImageJobInput, 'file' | 'name' | 'width' | 'height'>;

/** Pause after a settings change before re-running (typing a size shouldn't start 4 runs). */
export const SETTINGS_DEBOUNCE_MS = 350;

export interface FileJob {
  job: Job;
  /** The finished result (status 'done'). */
  result?: ImageJobResult;
  /** Made with the settings shown now; false while a settings change is waiting to re-run. */
  current: boolean;
}

/** Narrows a queue job's result (typed `unknown` by the shared queue) to an image result. */
export function isImageJobResult(value: unknown): value is ImageJobResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<Record<keyof ImageJobResult, unknown>>;
  return (
    r.blob instanceof Blob &&
    typeof r.name === 'string' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    typeof r.bytes === 'number' &&
    typeof r.format === 'string' &&
    Array.isArray(r.notes)
  );
}

export interface UseImageJobsOptions {
  /** Queued before the others (the file on screen). */
  first?: string;
  /** Called after each batch is queued, with the number of files in it. */
  onQueued?: (files: number) => void;
}

export function useImageJobs(
  files: readonly IntakeFile[],
  options: ImageJobOptions,
  { first, onQueued }: UseImageJobsOptions = {},
) {
  // Job options are plain data, so their JSON tells when the settings changed.
  const signature = JSON.stringify(options);
  const [entries, setEntries] = useState<ReadonlyMap<string, JobEntry>>(() => new Map());
  const entriesRef = useRef(new Map<string, JobEntry>());
  const appliedRef = useRef<string | null>(null);
  const latest = useRef({ files, options, first, onQueued });
  useEffect(() => {
    latest.current = { files, options, first, onQueued };
  });

  useEffect(() => {
    const settingsChanged = appliedRef.current !== null && appliedRef.current !== signature;
    const timer = setTimeout(
      () => {
        const { files: list, options: opts, first: top, onQueued: queued } = latest.current;
        const queue = useQueue.getState();
        const map = entriesRef.current;
        const plan = planJobs(
          list.map((f) => f.id),
          map,
          signature,
          top,
        );
        for (const jobId of plan.remove) queue.remove(jobId);
        for (const fileId of plan.forget) map.delete(fileId);
        const byId = new Map(list.map((f) => [f.id, f]));
        const adding = plan.add.flatMap((id) => byId.get(id) ?? []);
        if (adding.length > 0) {
          const ids = queue.add<ImageJobInput>(
            'image',
            'process',
            adding.map((f) => ({
              label: f.name,
              input: { ...opts, file: f.file, name: f.name, width: f.width, height: f.height },
            })),
          );
          ids.forEach((jobId, i) => {
            const file = adding[i];
            if (file) map.set(file.id, { jobId, signature });
          });
          queue.start();
          queued?.(adding.length);
        }
        appliedRef.current = signature;
        setEntries(new Map(map));
      },
      settingsChanged ? SETTINGS_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [files, signature]);

  // Leaving the page drops this tool's jobs (and their result blobs).
  useEffect(() => {
    const map = entriesRef.current;
    const applied = appliedRef;
    return () => {
      const queue = useQueue.getState();
      for (const entry of map.values()) queue.remove(entry.jobId);
      map.clear();
      applied.current = null;
    };
  }, []);

  const jobs = useQueue((s) => s.jobs);
  const byFile = useMemo(() => {
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const out = new Map<string, FileJob>();
    for (const [fileId, entry] of entries) {
      const job = byId.get(entry.jobId);
      if (!job) continue;
      const result = job.status === 'done' && isImageJobResult(job.result) ? job.result : undefined;
      out.set(fileId, { job, result, current: entry.signature === signature });
    }
    return out;
  }, [jobs, entries, signature]);

  const retry = useCallback(
    (fileId: string) => {
      const entry = entries.get(fileId);
      if (entry) useQueue.getState().retry(entry.jobId);
    },
    [entries],
  );

  return { byFile, retry };
}
