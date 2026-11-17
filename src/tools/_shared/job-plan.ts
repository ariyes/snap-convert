// Which queue jobs a single-image tool must add or remove when its files or settings change.
// Pure, so it can be tested without the queue.

/** The job that currently belongs to a file, and the settings it was made with. */
export interface JobEntry {
  jobId: string;
  /** Settings signature (JSON of the job options) the job was added with. */
  signature: string;
}

export interface JobPlan {
  /** Jobs to remove from the queue: their file is gone or their settings are out of date. */
  remove: string[];
  /** Files whose entry should be forgotten (file removed). */
  forget: string[];
  /** Files that need a (new) job, in the order to queue them. */
  add: string[];
}

/**
 * Compares the files and the current settings signature with the jobs already queued.
 * `first` (e.g. the file on screen) is queued before the others so its result shows first.
 * Failed jobs are not re-queued for the same settings (the user can retry them).
 */
export function planJobs(
  fileIds: readonly string[],
  entries: ReadonlyMap<string, JobEntry>,
  signature: string,
  first?: string,
): JobPlan {
  const plan: JobPlan = { remove: [], forget: [], add: [] };
  const present = new Set(fileIds);
  for (const [fileId, entry] of entries) {
    if (!present.has(fileId)) {
      plan.remove.push(entry.jobId);
      plan.forget.push(fileId);
    }
  }
  for (const fileId of fileIds) {
    const entry = entries.get(fileId);
    if (entry && entry.signature === signature) continue;
    if (entry) plan.remove.push(entry.jobId);
    plan.add.push(fileId);
  }
  if (first !== undefined) {
    const at = plan.add.indexOf(first);
    if (at > 0) plan.add.unshift(...plan.add.splice(at, 1));
  }
  return plan;
}
