// Analytics convention (P20b) for the single-image tools (Resize, Convert, HEIC to JPG, format
// pages): one tool-run per user-started run, never per re-run after a settings change.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { IntakeFile } from '@/core/contracts/intake';
import type { Job } from '@/core/contracts/queue';

// A stand-in for the shared queue: records jobs, runs nothing.
vi.mock('@/core/queue', () => {
  let next = 0;
  interface FakeQueue {
    jobs: Job[];
    add: (kind: string, op: string, items: Array<{ label: string; input: unknown }>) => string[];
    start: () => void;
    remove: (id: string) => void;
    retry: (id: string) => void;
  }
  const useQueue = create<FakeQueue>((set, get) => ({
    jobs: [],
    add: (kind, op, items) => {
      const added = items.map(({ label, input }) => ({
        id: `job-${++next}`,
        kind: kind as Job['kind'],
        op,
        label,
        input,
        status: 'waiting' as const,
        progress: 0,
      }));
      set({ jobs: [...get().jobs, ...added] });
      return added.map((j) => j.id);
    },
    start: () => undefined,
    remove: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
    retry: () => undefined,
  }));
  return { useQueue };
});

const { useQueue } = await import('@/core/queue');
const { SETTINGS_DEBOUNCE_MS, useImageJobs } = await import('./use-image-jobs');

function intake(id: string): IntakeFile {
  return {
    id,
    file: new File(['x'], `${id}.jpg`),
    name: `${id}.jpg`,
    size: 1,
    kind: 'image',
  };
}

const options = (quality: number) =>
  ({ format: 'jpeg', quality, metadata: 'strip-all', qualityGuard: true }) as const;

beforeEach(() => {
  vi.useFakeTimers();
  useQueue.setState({ jobs: [] });
});
afterEach(() => vi.useRealTimers());

describe('useImageJobs: tool-run once per user run', () => {
  it('counts added files, not re-runs for new settings', () => {
    const onRun = vi.fn();
    const a = intake('a');
    const b = intake('b');
    const { rerender } = renderHook(
      ({ files, quality }) => useImageJobs(files, options(quality), { onRun }),
      { initialProps: { files: [a, b], quality: 80 } },
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenLastCalledWith(2);
    expect(useQueue.getState().jobs).toHaveLength(2);

    // Two settings changes: both files are processed again, but it's not a new run.
    rerender({ files: [a, b], quality: 70 });
    act(() => {
      vi.advanceTimersByTime(SETTINGS_DEBOUNCE_MS);
    });
    rerender({ files: [a, b], quality: 60 });
    act(() => {
      vi.advanceTimersByTime(SETTINGS_DEBOUNCE_MS);
    });
    expect(useQueue.getState().jobs.map((j) => (j.input as { quality: number }).quality)).toEqual([
      60, 60,
    ]);
    expect(onRun).toHaveBeenCalledTimes(1);

    // Adding a file is a new run, for that file.
    rerender({ files: [a, b, intake('c')], quality: 60 });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(onRun).toHaveBeenCalledTimes(2);
    expect(onRun).toHaveBeenLastCalledWith(1);
  });
});
