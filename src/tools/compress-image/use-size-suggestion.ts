// Honest "Resize to N px" (P20b): the pipeline's size estimate can be optimistic on detailed
// photos, so before the button is offered the suggestion is tried — the same job at that size, on
// the shared queue (image worker) — and stepped down until it fits (at most 3 tries). Tapping the
// button then runs exactly the job that was tried, so it always reaches the target.
import { useEffect, useState } from 'react';
import type { ImageJobInput, ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import type { Size } from '@/core/contracts/sizing';
import { useQueue } from '@/core/queue';
import { verifySuggestedSize, type SizeTry, type VerifiedSize } from '@/engines/optimize/target';
import { JobCancelled, runQueued, type QueueLike } from '@/tools/_shared';
import type { SizeSuggestion } from './notes';
import { jobInput, jobOptions, type CompressSettings } from './settings';

/** Whether a result offers a resize (not a format switch) for a missed target. */
export function needsSizeCheck(
  result: Pick<ImageJobResult, 'notes' | 'suggestedSize' | 'suggestedFormat'> | undefined,
  settings: Pick<CompressSettings, 'qualityMode'>,
): result is ImageJobResult & { suggestedSize: Size } {
  return (
    !!result &&
    settings.qualityMode === 'target' &&
    result.notes.includes('target-unreachable') &&
    !!result.suggestedSize &&
    !result.suggestedFormat
  );
}

/** The settings the one-tap fix applies (as the note's patch does). */
export function resizedSettings(settings: CompressSettings, size: Size): CompressSettings {
  return {
    ...settings,
    resizeEnabled: true,
    resizeMode: 'longest',
    resizeSize: Math.max(size.width, size.height),
    preset: null,
  };
}

/** Runs one image job and gives its result (on the queue in the app, a worker in tests). */
export type RunImageJob = (input: ImageJobInput) => Promise<ImageJobResult>;

/** Runs image jobs on the shared queue; `onJob` sees every job id (to cancel). */
export function queueRunner(queue: QueueLike, onJob?: (id: string) => void): RunImageJob {
  return (input) => {
    const job = runQueued<ImageJobInput, ImageJobResult>(
      queue,
      'image',
      'process',
      input.name,
      input,
    );
    onJob?.(job.id);
    return job.done;
  };
}

/**
 * Tries a size suggestion for `file` with `settings` — the exact job the one-tap fix will run —
 * and steps it down until it fits. Returns the checked size and whether a try fitted.
 */
export async function checkSuggestion(
  run: RunImageJob,
  file: Pick<IntakeFile, 'file' | 'name' | 'width' | 'height'>,
  settings: CompressSettings,
  suggested: Size,
): Promise<VerifiedSize> {
  const targetBytes = settings.targetKb * 1024;
  const tryAt = async (size: Size): Promise<SizeTry> => {
    const result = await run(jobInput(file, jobOptions(resizedSettings(settings, size))));
    return {
      bytes: result.bytes,
      reached: !result.notes.includes('target-unreachable'),
      suggestedSize: result.suggestedSize,
    };
  };
  return verifySuggestedSize(suggested, targetBytes, tryAt);
}

/**
 * The checked suggestion for the file on screen, or undefined when its result needs none. `key`
 * identifies the settings the result was made with (a new key starts a new check).
 */
export function useSizeSuggestion(
  file: IntakeFile | null,
  result: ImageJobResult | undefined,
  settings: CompressSettings,
  key: string,
): SizeSuggestion | undefined {
  const needed = file !== null && needsSizeCheck(result, settings);
  const id = needed ? `${file.id}|${key}|${result.suggestedSize.width}` : null;
  const [checked, setChecked] = useState<{ id: string; size: Size } | null>(null);

  useEffect(() => {
    if (id === null || !file || !needsSizeCheck(result, settings)) return;
    let alive = true;
    const jobs: string[] = [];
    const run = queueRunner(useQueue, (job) => jobs.push(job));
    checkSuggestion(run, file, settings, result.suggestedSize).then(
      ({ size }) => {
        if (alive) setChecked({ id, size });
      },
      (error: unknown) => {
        // Cancelled (settings changed, page left) or failed: offer the estimate as it is.
        if (alive && !(error instanceof JobCancelled)) {
          setChecked({ id, size: result.suggestedSize });
        }
      },
    );
    return () => {
      alive = false;
      const queue = useQueue.getState();
      for (const job of jobs) queue.cancel(job);
    };
    // Re-run only for a new file, result or settings key (`id` covers all three).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (id === null) return undefined;
  return checked?.id === id ? { status: 'ready', size: checked.size } : { status: 'checking' };
}
