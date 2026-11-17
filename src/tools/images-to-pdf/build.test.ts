import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import type { ImageJobInput } from '@/core/contracts/image';
import type { ImagesToPdfInput } from '@/core/contracts/pdf';
import type { Job, JobKind } from '@/core/contracts/queue';
import { buildPdf, ConversionCache, ImageFailed } from './build';
import { formatBytes } from './format';
import { JobCancelled, runQueued, type QueueLike } from './queue-job';
import { defaultSettings } from './settings';

/** A queue store that runs nothing by itself: tests finish jobs by hand. */
function fakeQueue() {
  let n = 0;
  const store = create<{
    jobs: Job[];
    add: (kind: JobKind, op: string, items: Array<{ label: string; input: unknown }>) => string[];
    start: () => void;
    cancel: (id?: string) => void;
    remove: (id: string) => void;
  }>()((set, get) => ({
    jobs: [],
    add: (kind, op, items) => {
      const added = items.map(({ label, input }) => ({
        id: `job-${++n}`,
        kind,
        op,
        label,
        input,
        status: 'waiting' as const,
        progress: 0,
      }));
      set({ jobs: [...get().jobs, ...added] });
      return added.map((j) => j.id);
    },
    start: () => {},
    cancel: (id) =>
      set({
        jobs: get().jobs.map((j) =>
          id === undefined || j.id === id ? { ...j, status: 'cancelled' } : j,
        ),
      }),
    remove: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
  }));
  const patch = (id: string, p: Partial<Job>) =>
    store.setState({ jobs: store.getState().jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) });
  return { queue: store as QueueLike, store, patch };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await flush();
  expect(check()).toBe(true);
};

const fixture = (file: string, name = path.basename(file)) => ({
  id: name,
  name,
  file: new File([readFileSync(path.resolve('tests/fixtures', file))], name),
  width: 80,
  height: 60,
});

describe('runQueued', () => {
  it('resolves with the result, reports progress and removes the job', async () => {
    const { queue, store, patch } = fakeQueue();
    const progress: number[] = [];
    const job = runQueued<string, number>(queue, 'pdf', 'merge', 'x', 'in', (p) =>
      progress.push(p),
    );
    patch(job.id, { status: 'working', progress: 0.5 });
    patch(job.id, { status: 'done', progress: 1, result: 42 });
    await expect(job.done).resolves.toBe(42);
    expect(progress).toEqual([0, 0.5, 1]);
    expect(store.getState().jobs).toEqual([]);
  });

  it('rejects with the job error, or JobCancelled when cancelled or removed', async () => {
    const { queue, store, patch } = fakeQueue();
    const failed = runQueued(queue, 'image', 'process', 'a', {});
    patch(failed.id, { status: 'failed', error: 'Broken image' });
    await expect(failed.done).rejects.toThrow('Broken image');

    const cancelled = runQueued(queue, 'image', 'process', 'b', {});
    store.getState().cancel(cancelled.id);
    await expect(cancelled.done).rejects.toBeInstanceOf(JobCancelled);

    const removed = runQueued(queue, 'image', 'process', 'c', {});
    store.getState().remove(removed.id);
    await expect(removed.done).rejects.toBeInstanceOf(JobCancelled);
    expect(store.getState().jobs).toEqual([]);
  });
});

describe('buildPdf', () => {
  const settings = { ...defaultSettings(['en-GB']), margin: 'small' as const };

  it('converts only what a PDF can’t hold, then builds in the given order', async () => {
    const { queue, store, patch } = fakeQueue();
    const cache = new ConversionCache(queue);
    const files = [
      fixture('images/sample.webp', 'b.webp'),
      fixture('images/no-exif.jpg', 'a.jpg'),
      fixture('images/alpha.png', 'c.png'),
    ];
    const seen: number[] = [];
    const building = buildPdf({
      files,
      settings,
      outName: 'out.pdf',
      queue,
      cache,
      onProgress: (p) => seen.push(p),
    });

    await until(() => store.getState().jobs.length === 1);
    const [image] = store.getState().jobs;
    expect(image).toMatchObject({ kind: 'image', op: 'process', label: 'b.webp' });
    expect((image?.input as ImageJobInput).format).toBe('jpeg');
    const converted = new Blob(['jpeg']);
    patch(image!.id, { status: 'done', progress: 1, result: { blob: converted } });

    await until(() => store.getState().jobs.some((j) => j.kind === 'pdf'));
    const pdfJob = store.getState().jobs.find((j) => j.kind === 'pdf')!;
    expect(pdfJob.op).toBe('images-to-pdf');
    const input = pdfJob.input as ImagesToPdfInput;
    expect(input.images.map((i) => i.name)).toEqual(['b.webp', 'a.jpg', 'c.png']);
    expect(input.images[0]?.blob).toBe(converted);
    expect(input.images[1]?.blob).toBe(files[1]?.file);
    expect(input).toMatchObject({
      pageSize: 'a4',
      orientation: 'auto',
      marginMm: 10,
      outName: 'out.pdf',
    });
    const output = { blob: new Blob(['%PDF']), name: 'out.pdf', pages: 3 };
    patch(pdfJob.id, { status: 'done', progress: 1, result: { files: [output] } });
    await expect(building).resolves.toBe(output);
    expect(store.getState().jobs).toEqual([]);
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((p, i) => i === 0 || p >= (seen[i - 1] ?? 0))).toBe(true);
  });

  it('reuses converted images on the next build', async () => {
    const { queue, store, patch } = fakeQueue();
    const cache = new ConversionCache(queue);
    const files = [fixture('images/sample.avif', 'x.avif')];
    const run = () => buildPdf({ files, settings, outName: 'o.pdf', queue, cache });

    const first = run();
    await until(() => store.getState().jobs.length === 1);
    patch(store.getState().jobs[0]!.id, { status: 'done', result: { blob: new Blob(['j']) } });
    await until(() => store.getState().jobs.some((j) => j.kind === 'pdf'));
    const done = (j: Job) => ({
      status: 'done' as const,
      result: { files: [{ pages: 1 }] },
      id: j.id,
    });
    patch(store.getState().jobs[0]!.id, done(store.getState().jobs[0]!));
    await first;

    const second = run();
    await until(() => store.getState().jobs.length === 1);
    expect(store.getState().jobs[0]?.kind).toBe('pdf');
    patch(store.getState().jobs[0]!.id, done(store.getState().jobs[0]!));
    await second;
  });

  it('names the image that failed', async () => {
    const { queue, store, patch } = fakeQueue();
    const cache = new ConversionCache(queue);
    const building = buildPdf({
      files: [fixture('images/iphone-7.heic', 'p.heic')],
      settings,
      outName: 'o.pdf',
      queue,
      cache,
    });
    await until(() => store.getState().jobs.length === 1);
    patch(store.getState().jobs[0]!.id, { status: 'failed', error: 'Not a photo' });
    const error = await building.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageFailed);
    expect(error).toMatchObject({ fileId: 'p.heic', message: 'Not a photo' });
  });

  it('stops when aborted', async () => {
    const { queue, store } = fakeQueue();
    const controller = new AbortController();
    const ids: string[] = [];
    const building = buildPdf({
      files: [fixture('images/sample.gif', 'g.gif')],
      settings,
      outName: 'o.pdf',
      queue,
      cache: new ConversionCache(queue),
      signal: controller.signal,
      onJob: (id) => ids.push(id),
    });
    await until(() => store.getState().jobs.length === 1);
    expect(ids).toHaveLength(1);
    controller.abort();
    await expect(building).rejects.toBeInstanceOf(JobCancelled);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [830, '830 B'],
    [4710, '4.6 KB'],
    [512_000, '500 KB'],
    [3_565_158, '3.4 MB'],
    [52_428_800, '50 MB'],
    [3 * 1024 ** 3, '3.0 GB'],
    [Number.NaN, '—'],
  ])('%d → %s', (n, text) => {
    expect(formatBytes(n)).toBe(text);
  });
});
