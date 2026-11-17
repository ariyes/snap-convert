import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { ImageJobInput } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import type { Job } from '@/core/contracts/queue';

// A stand-in for the shared queue: records jobs, runs nothing.
const fake = vi.hoisted(() => ({ next: 0, started: 0 }));
vi.mock('@/core/queue', () => {
  interface FakeQueue {
    jobs: Job[];
    add: (kind: string, op: string, items: Array<{ label: string; input: unknown }>) => string[];
    start: () => void;
    remove: (id: string) => void;
  }
  const useQueue = create<FakeQueue>((set, get) => ({
    jobs: [],
    add: (kind, op, items) => {
      const added = items.map(({ label, input }) => ({
        id: `job-${++fake.next}`,
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
    start: () => {
      fake.started++;
    },
    remove: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
  }));
  return { useQueue };
});
const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({ track }));

const { useQueue } = await import('@/core/queue');
const { dropAllJobs, syncJobs, useRunStore } = await import('./use-optimize-run');

function intake(id: string): IntakeFile {
  return {
    id,
    file: new File(['x'], `${id}.jpg`),
    name: `${id}.jpg`,
    size: 1,
    kind: 'image',
    width: 3000,
    height: 2000,
  };
}

const queued = () => useQueue.getState().jobs;
const inputs = () => queued().map((j) => j.input as ImageJobInput);

beforeEach(() => {
  dropAllJobs();
  useQueue.setState({ jobs: [] });
  track.mockClear();
  fake.started = 0;
});

describe('syncJobs', () => {
  it('queues one guarded preset job per new file and starts the queue', () => {
    syncJobs([intake('a'), intake('b')], { destination: 'shopify', format: 'jpeg' });
    expect(queued().map((j) => [j.kind, j.op, j.label])).toEqual([
      ['image', 'process', 'a.jpg'],
      ['image', 'process', 'b.jpg'],
    ]);
    expect(inputs().every((i) => i.qualityGuard && i.resize?.value === 2048)).toBe(true);
    expect(fake.started).toBe(1);
    expect(track).toHaveBeenCalledWith({ name: 'tool-run', tool: 'optimize-for-web', files: 2 });
  });

  it('only queues files that have no job yet', () => {
    const settings = { destination: 'web', format: 'jpeg' } as const;
    syncJobs([intake('a')], settings);
    syncJobs([intake('a'), intake('b')], settings);
    expect(queued().map((j) => j.label)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('runs everything again when the destination or format changes', () => {
    syncJobs([intake('a'), intake('b')], { destination: 'web', format: 'jpeg' });
    const before = queued().map((j) => j.id);
    syncJobs([intake('a'), intake('b')], { destination: 'email', format: 'webp' });
    const after = queued();
    expect(after).toHaveLength(2);
    expect(after.some((j) => before.includes(j.id))).toBe(false);
    expect(inputs().map((i) => [i.format, i.resize?.value])).toEqual([
      ['webp', 800],
      ['webp', 800],
    ]);
  });

  it('drops the jobs of removed files, and all jobs when the page leaves', () => {
    const settings = { destination: 'web', format: 'jpeg' } as const;
    syncJobs([intake('a'), intake('b')], settings);
    syncJobs([intake('b')], settings);
    expect(queued().map((j) => j.label)).toEqual(['b.jpg']);
    dropAllJobs();
    expect(queued()).toEqual([]);
    expect(useRunStore.getState().jobIds).toEqual({});
  });

  it("never touches other tools' jobs", () => {
    useQueue.getState().add('pdf', 'merge', [{ label: 'other', input: {} }]);
    syncJobs([intake('a')], { destination: 'web', format: 'jpeg' });
    syncJobs([intake('a')], { destination: 'blog', format: 'jpeg' });
    dropAllJobs();
    expect(queued().map((j) => j.label)).toEqual(['other']);
  });
});
