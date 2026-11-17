// Which queue jobs the page needs: one per file for the current settings, the selected file first.
// Pure, so the rules are easy to test; use-compress-jobs.ts applies the plan to the queue.
import type { JobStatus } from '@/core/contracts/queue';

/** A job this page added: for which file, with which settings key, and in what order. */
export interface Entry {
  fileId: string;
  jobId: string;
  key: string;
  /** Order the page added it in (the queue runs jobs first in, first out). */
  seq: number;
}

export interface PlanInput {
  /** File ids in list order. */
  fileIds: readonly string[];
  selectedId: string | null;
  /** Settings key of the results wanted now. */
  key: string;
  entries: readonly Entry[];
  /** Status of a job in the queue; undefined when it is gone (e.g. another page cleared the queue). */
  status: (jobId: string) => JobStatus | undefined;
}

export interface Plan {
  /** Jobs to remove from the queue (stale, orphaned, or re-queued behind the selected file). */
  remove: string[];
  /** Files to add jobs for, in this order. */
  add: string[];
}

/**
 * - A job for a removed file or made with other settings is stale: removed (a working one is
 *   stopped, so the current settings get the worker).
 * - A cancelled or vanished job is replaced. A failed one stays, to show its error.
 * - The selected file goes first: when it would wait behind other waiting jobs of this page, those
 *   are taken out and added again after it (they haven't started, so nothing is lost).
 */
export function planJobs({ fileIds, selectedId, key, entries, status }: PlanInput): Plan {
  const files = new Set(fileIds);
  const remove: string[] = [];
  const live = new Map<string, Entry>();

  for (const entry of entries) {
    const s = status(entry.jobId);
    const keep =
      files.has(entry.fileId) &&
      entry.key === key &&
      s !== undefined &&
      s !== 'cancelled' &&
      !live.has(entry.fileId);
    if (keep) live.set(entry.fileId, entry);
    else if (s !== undefined) remove.push(entry.jobId);
  }

  const order =
    selectedId !== null && files.has(selectedId)
      ? [selectedId, ...fileIds.filter((id) => id !== selectedId)]
      : [...fileIds];
  const needed = new Set(order.filter((id) => !live.has(id)));

  const waiting = [...live.values()].filter((e) => status(e.jobId) === 'waiting');
  const selected = selectedId === null ? undefined : live.get(selectedId);
  const firstWaiting = Math.min(...waiting.map((e) => e.seq));
  const selectedBehind =
    selectedId !== null &&
    files.has(selectedId) &&
    waiting.length > 0 &&
    (needed.has(selectedId) ||
      (selected !== undefined &&
        status(selected.jobId) === 'waiting' &&
        selected.seq !== firstWaiting));

  if (selectedBehind) {
    for (const entry of waiting) {
      remove.push(entry.jobId);
      needed.add(entry.fileId);
    }
  }

  return { remove, add: order.filter((id) => needed.has(id)) };
}
