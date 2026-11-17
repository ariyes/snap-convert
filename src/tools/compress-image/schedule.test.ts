import { describe, expect, it } from 'vitest';
import type { JobStatus } from '@/core/contracts/queue';
import { planJobs, type Entry } from './schedule';

const entry = (fileId: string, key: string, seq: number): Entry => ({
  fileId,
  jobId: `job-${fileId}-${key}-${seq}`,
  key,
  seq,
});

function statuses(map: Record<string, JobStatus>) {
  return (id: string) => map[id];
}

describe('planJobs', () => {
  it('adds a job for every file, the selected one first', () => {
    const plan = planJobs({
      fileIds: ['a', 'b', 'c'],
      selectedId: 'b',
      key: 'k1',
      entries: [],
      status: () => undefined,
    });
    expect(plan).toEqual({ remove: [], add: ['b', 'a', 'c'] });
  });

  it('keeps jobs made with the current settings (waiting, working, done or failed)', () => {
    const entries = [entry('a', 'k1', 1), entry('b', 'k1', 2), entry('c', 'k1', 3)];
    const plan = planJobs({
      fileIds: ['a', 'b', 'c'],
      selectedId: 'a',
      key: 'k1',
      entries,
      status: statuses({
        [entries[0]!.jobId]: 'done',
        [entries[1]!.jobId]: 'working',
        [entries[2]!.jobId]: 'failed',
      }),
    });
    expect(plan).toEqual({ remove: [], add: [] });
  });

  it('removes stale jobs (other settings) and replaces them, working ones included', () => {
    const entries = [entry('a', 'old', 1), entry('b', 'old', 2)];
    const plan = planJobs({
      fileIds: ['a', 'b'],
      selectedId: 'a',
      key: 'new',
      entries,
      status: statuses({ [entries[0]!.jobId]: 'done', [entries[1]!.jobId]: 'working' }),
    });
    expect(plan.remove).toEqual([entries[0]!.jobId, entries[1]!.jobId]);
    expect(plan.add).toEqual(['a', 'b']);
  });

  it('removes the job of a file that left the list', () => {
    const entries = [entry('a', 'k1', 1), entry('gone', 'k1', 2)];
    const plan = planJobs({
      fileIds: ['a'],
      selectedId: 'a',
      key: 'k1',
      entries,
      status: statuses({ [entries[0]!.jobId]: 'done', [entries[1]!.jobId]: 'waiting' }),
    });
    expect(plan).toEqual({ remove: [entries[1]!.jobId], add: [] });
  });

  it('replaces cancelled jobs and jobs that vanished from the queue', () => {
    const entries = [entry('a', 'k1', 1), entry('b', 'k1', 2)];
    const plan = planJobs({
      fileIds: ['a', 'b'],
      selectedId: 'a',
      key: 'k1',
      entries,
      status: statuses({ [entries[0]!.jobId]: 'cancelled' }),
    });
    expect(plan.remove).toEqual([entries[0]!.jobId]);
    expect(plan.add).toEqual(['a', 'b']);
  });

  it('moves the selected file ahead of this page’s other waiting jobs', () => {
    const entries = [entry('a', 'k1', 1), entry('b', 'k1', 2), entry('c', 'k1', 3)];
    const plan = planJobs({
      fileIds: ['a', 'b', 'c'],
      selectedId: 'c',
      key: 'k1',
      entries,
      status: statuses({
        [entries[0]!.jobId]: 'working',
        [entries[1]!.jobId]: 'waiting',
        [entries[2]!.jobId]: 'waiting',
      }),
    });
    // a keeps working; b and c are taken out and re-added with c first.
    expect(plan.remove).toEqual([entries[1]!.jobId, entries[2]!.jobId]);
    expect(plan.add).toEqual(['c', 'b']);
  });

  it('puts a newly added selected file ahead of waiting jobs', () => {
    const entries = [entry('a', 'k1', 1), entry('b', 'k1', 2)];
    const plan = planJobs({
      fileIds: ['a', 'b', 'new'],
      selectedId: 'new',
      key: 'k1',
      entries,
      status: statuses({ [entries[0]!.jobId]: 'working', [entries[1]!.jobId]: 'waiting' }),
    });
    expect(plan.remove).toEqual([entries[1]!.jobId]);
    expect(plan.add).toEqual(['new', 'b']);
  });

  it('leaves the order alone when the selected file is already next', () => {
    const entries = [entry('a', 'k1', 1), entry('b', 'k1', 2)];
    const plan = planJobs({
      fileIds: ['a', 'b'],
      selectedId: 'a',
      key: 'k1',
      entries,
      status: statuses({ [entries[0]!.jobId]: 'waiting', [entries[1]!.jobId]: 'waiting' }),
    });
    expect(plan).toEqual({ remove: [], add: [] });
  });

  it('is stable: applying a plan and planning again changes nothing', () => {
    const fileIds = ['a', 'b', 'c'];
    const first = planJobs({
      fileIds,
      selectedId: 'b',
      key: 'k1',
      entries: [],
      status: () => undefined,
    });
    const entries = first.add.map((id, i) => entry(id, 'k1', i + 1));
    const waiting: Record<string, JobStatus> = Object.fromEntries(
      entries.map((e) => [e.jobId, 'waiting']),
    );
    const second = planJobs({
      fileIds,
      selectedId: 'b',
      key: 'k1',
      entries,
      status: statuses(waiting),
    });
    expect(second).toEqual({ remove: [], add: [] });
  });

  it('handles an empty list', () => {
    expect(
      planJobs({ fileIds: [], selectedId: null, key: 'k', entries: [], status: () => undefined }),
    ).toEqual({ remove: [], add: [] });
  });
});
