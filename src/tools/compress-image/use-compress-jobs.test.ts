// Analytics convention (P20b) for Compress: one tool-run per user-started run (files added), not
// one per debounced re-run after a settings change.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { IntakeFile } from '@/core/contracts/intake';
import type { Job } from '@/core/contracts/queue';

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
const { useCompressJobs } = await import('./use-compress-jobs');
const { COMPRESS_DEFAULTS, jobOptions, optionsKey } = await import('./settings');

function intake(id: string): IntakeFile {
  return { id, file: new File(['x'], `${id}.jpg`), name: `${id}.jpg`, size: 1, kind: 'image' };
}

const run = (quality: number) => {
  const options = jobOptions({ ...COMPRESS_DEFAULTS, quality, qualitySet: true });
  return { options, key: optionsKey(options) };
};

beforeEach(() => useQueue.setState({ jobs: [] }));

describe('useCompressJobs: tool-run once per user run', () => {
  it('counts added files, not re-runs for new settings', () => {
    const onRun = vi.fn();
    const a = intake('a');
    const b = intake('b');
    const { rerender } = renderHook(
      ({ files, quality, selected }) => {
        const { options, key } = run(quality);
        return useCompressJobs(files, selected, options, key, onRun);
      },
      { initialProps: { files: [a, b], quality: 80, selected: 'a' } },
    );
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenLastCalledWith(2);

    // New settings and a new selection re-queue the files: not a new run.
    rerender({ files: [a, b], quality: 70, selected: 'a' });
    rerender({ files: [a, b], quality: 60, selected: 'b' });
    expect(useQueue.getState().jobs.length).toBeGreaterThanOrEqual(2);
    expect(onRun).toHaveBeenCalledTimes(1);

    rerender({ files: [a, b, intake('c')], quality: 60, selected: 'b' });
    expect(onRun).toHaveBeenCalledTimes(2);
    expect(onRun).toHaveBeenLastCalledWith(1);
  });
});
