import { useEffect, useRef, useState } from 'react';
import type { Job } from '@/core/contracts';
import type { PdfResult } from '@/core/contracts/pdf';
import { useQueue } from '@/core/queue';
import type { PdfOp } from '@/engines/pdf';

function isPdfResult(value: unknown): value is PdfResult {
  if (typeof value !== 'object' || value === null || !('files' in value)) return false;
  const { files } = value;
  return (
    Array.isArray(files) &&
    files.every(
      (f: unknown) =>
        typeof f === 'object' &&
        f !== null &&
        'blob' in f &&
        f.blob instanceof Blob &&
        'name' in f &&
        typeof f.name === 'string' &&
        'pages' in f &&
        typeof f.pages === 'number',
    )
  );
}

/** The files a finished PDF job produced, or null. */
export function pdfResultOf(job: Job | undefined): PdfResult | null {
  return job?.status === 'done' && isPdfResult(job.result) ? job.result : null;
}

/**
 * One PDF job at a time for a tool page, on the shared queue. Only this page's job is shown; it is
 * removed when a new one starts, when `discard` is called and when the page is left (which also
 * cancels it if it is still running).
 */
export function usePdfJob() {
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useQueue((s) => (jobId === null ? undefined : s.jobs.find((j) => j.id === jobId)));

  const latestId = useRef(jobId);
  useEffect(() => {
    latestId.current = jobId;
  });
  useEffect(
    () => () => {
      if (latestId.current !== null) useQueue.getState().remove(latestId.current);
    },
    [],
  );

  const run = <I>(op: PdfOp, label: string, input: I): string => {
    const queue = useQueue.getState();
    if (jobId !== null) queue.remove(jobId);
    const [id = ''] = queue.add('pdf', op, [{ label, input }]);
    queue.start();
    setJobId(id);
    return id;
  };

  const cancel = () => {
    if (jobId !== null) useQueue.getState().cancel(jobId);
  };

  const discard = () => {
    if (jobId !== null) useQueue.getState().remove(jobId);
    setJobId(null);
  };

  return { job, result: pdfResultOf(job), run, cancel, discard };
}
