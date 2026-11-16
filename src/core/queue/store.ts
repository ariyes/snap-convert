// Queue store (Zustand): QueueApi + { jobs, stats }. Jobs run first-in, first-out on a WorkerPool.
// Status flow: waiting → working → done | failed | cancelled (a waiting job can also be cancelled).

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Job, JobKind, QueueApi, QueueStats } from '@/core/contracts';
import { isHeavyInput } from './device';
import { jobErrorMessage } from './errors';
import { createEtaSmoother, runFraction, type EtaSmoother } from './eta';
import type { RunOutcome, WorkerPool } from './pool';
import { queueStrings } from './strings';

export interface QueueState extends QueueApi {
  jobs: Job[];
  stats: QueueStats;
}

export type QueueStore = UseBoundStore<StoreApi<QueueState>>;

/** While jobs are working, progress and the time left reach the store this often. */
export const PROGRESS_TICK_MS = 100;

export interface QueueStoreOptions {
  /** The pool, or a function that makes it on first use (keeps prerender free of workers). */
  pool: WorkerPool | (() => WorkerPool);
  tickMs?: number;
}

interface Run {
  /** Jobs that belong to this run (for the time-left fraction). */
  ids: Set<string>;
  /** performance.now() when the first job of the run started working. */
  startedAt: number | null;
  eta: EtaSmoother;
}

const EMPTY_STATS: QueueStats = {
  total: 0,
  waiting: 0,
  working: 0,
  done: 0,
  failed: 0,
  etaSeconds: null,
};

let idCounter = 0;
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Not a secure context: fall through to the counter.
  }
  idCounter += 1;
  return `job-${Date.now().toString(36)}-${idCounter}`;
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

export function createQueueStore(options: QueueStoreOptions): QueueStore {
  const tickMs = options.tickMs ?? PROGRESS_TICK_MS;
  let pool: WorkerPool | null = typeof options.pool === 'function' ? null : options.pool;
  const getPool = (): WorkerPool => {
    if (pool === null && typeof options.pool === 'function') pool = options.pool();
    if (pool === null) throw new Error('Queue has no worker pool');
    return pool;
  };

  /** start() was called and the queue hasn't been stopped by cancel all / clear. */
  let active = false;
  /** Abort controllers of working jobs. */
  const running = new Map<string, AbortController>();
  /** FIFO position of each job; retry moves a job to the back. */
  const order = new Map<string, number>();
  let seq = 0;
  /** Over 40 MP / 100 MB: runs alone. Worked out once per job. */
  const heavy = new Map<string, boolean>();
  /** Latest progress from workers, written to the store on the next tick. */
  const pendingProgress = new Map<string, number>();
  let run: Run | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  return create<QueueState>()((set, get) => {
    function etaSeconds(jobs: readonly Job[]): number | null {
      if (!run || run.startedAt === null) return null;
      const byId = new Map(jobs.map((j) => [j.id, j]));
      const progresses: number[] = [];
      for (const id of run.ids) {
        const job = byId.get(id);
        if (!job) continue;
        if (job.status === 'waiting') progresses.push(0);
        // The freshest progress, even if it hasn't been written to the job yet (less lag early on).
        else if (job.status === 'working') progresses.push(pendingProgress.get(id) ?? job.progress);
        else progresses.push(1);
      }
      const now = performance.now();
      return run.eta.update((now - run.startedAt) / 1000, runFraction(progresses), now / 1000);
    }

    function computeStats(jobs: readonly Job[]): QueueStats {
      const stats = { ...EMPTY_STATS, total: jobs.length };
      for (const j of jobs) {
        if (j.status === 'waiting') stats.waiting++;
        else if (j.status === 'working') stats.working++;
        else if (j.status === 'done') stats.done++;
        else if (j.status === 'failed') stats.failed++;
      }
      stats.etaSeconds = etaSeconds(jobs);
      return stats;
    }

    function setJobs(jobs: Job[]): void {
      set({ jobs, stats: computeStats(jobs) });
    }

    function patchJob(id: string, patch: Partial<Job>): void {
      setJobs(get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    }

    function joinRun(ids: Iterable<string>): void {
      run ??= { ids: new Set(), startedAt: null, eta: createEtaSmoother() };
      for (const id of ids) run.ids.add(id);
    }

    function stopTicker(): void {
      if (ticker !== null) {
        clearInterval(ticker);
        ticker = null;
      }
    }

    function tick(): void {
      const { jobs } = get();
      let next = jobs;
      if (pendingProgress.size > 0) {
        next = jobs.map((j) => {
          const p = pendingProgress.get(j.id);
          return p !== undefined && j.status === 'working' && p !== j.progress
            ? { ...j, progress: p }
            : j;
        });
        pendingProgress.clear();
      }
      setJobs(next);
      if (!jobs.some((j) => j.status === 'working')) stopTicker();
    }

    /** Ends the run when nothing is waiting (to run) or working. */
    function settleRun(): void {
      const { jobs } = get();
      const working = jobs.some((j) => j.status === 'working');
      const waiting = active && jobs.some((j) => j.status === 'waiting');
      if (!working) stopTicker();
      if (!working && !waiting && run !== null) {
        run = null;
        setJobs(jobs);
      }
    }

    function nextWaiting(jobs: readonly Job[]): Job | undefined {
      let best: Job | undefined;
      let bestSeq = Number.POSITIVE_INFINITY;
      for (const j of jobs) {
        if (j.status !== 'waiting') continue;
        const s = order.get(j.id) ?? 0;
        if (s < bestSeq) {
          best = j;
          bestSeq = s;
        }
      }
      return best;
    }

    function pump(): void {
      if (active) {
        const capacity = getPool().size;
        for (;;) {
          const { jobs } = get();
          const working = jobs.filter((j) => j.status === 'working');
          if (working.length >= capacity) break;
          const next = nextWaiting(jobs);
          if (!next) break;
          // A heavy job waits for the pool to empty, and nothing joins it (FIFO is kept).
          const alone = heavy.get(next.id) === true || working.some((j) => heavy.get(j.id));
          if (alone && working.length > 0) break;
          startJob(next);
        }
      }
      settleRun();
    }

    function startJob(job: Job): void {
      joinRun([job.id]);
      if (run && run.startedAt === null) run.startedAt = performance.now();
      const ctrl = new AbortController();
      running.set(job.id, ctrl);
      pendingProgress.delete(job.id);
      patchJob(job.id, {
        status: 'working',
        progress: 0,
        startedAt: Date.now(),
        endedAt: undefined,
        error: undefined,
        result: undefined,
      });
      ticker ??= setInterval(tick, tickMs);
      void execute(job, ctrl);
    }

    async function execute(job: Job, ctrl: AbortController): Promise<void> {
      const onProgress = (p: number) => {
        if (!ctrl.signal.aborted) pendingProgress.set(job.id, clamp01(p));
      };
      let outcome: RunOutcome;
      try {
        outcome = await getPool().run(job.kind, job.op, job.input, onProgress, ctrl.signal);
      } catch (error) {
        outcome = { type: 'unavailable', error };
      }
      // Cancelled or removed: whoever aborted has already updated the store.
      if (ctrl.signal.aborted || running.get(job.id) !== ctrl) return;
      running.delete(job.id);
      pendingProgress.delete(job.id);
      const endedAt = Date.now();
      switch (outcome.type) {
        case 'done':
          patchJob(job.id, { status: 'done', progress: 1, result: outcome.value, endedAt });
          break;
        case 'error':
          patchJob(job.id, { status: 'failed', error: jobErrorMessage(outcome.error), endedAt });
          break;
        case 'crash':
          patchJob(job.id, { status: 'failed', error: queueStrings.tooLarge, endedAt });
          break;
        case 'unavailable':
          patchJob(job.id, { status: 'failed', error: queueStrings.unavailable, endedAt });
          break;
        case 'aborted':
          patchJob(job.id, { status: 'cancelled', endedAt });
          break;
      }
      pump();
    }

    /** Stops a working job: its worker is terminated (the pool makes a new one when needed). */
    function stopWorking(id: string): void {
      const ctrl = running.get(id);
      running.delete(id);
      pendingProgress.delete(id);
      ctrl?.abort();
    }

    return {
      jobs: [],
      stats: { ...EMPTY_STATS },

      add<I>(kind: JobKind, op: string, items: Array<{ label: string; input: I }>): string[] {
        const ids: string[] = [];
        const added: Job[] = items.map(({ label, input }) => {
          const id = newId();
          ids.push(id);
          order.set(id, ++seq);
          heavy.set(id, isHeavyInput(input));
          return { id, kind, op, label, input, status: 'waiting', progress: 0 };
        });
        if (active) joinRun(ids);
        setJobs([...get().jobs, ...added]);
        pump();
        return ids;
      },

      start() {
        active = true;
        joinRun(get().jobs.filter((j) => j.status === 'waiting').map((j) => j.id));
        pump();
      },

      cancel(id?: string) {
        if (id === undefined) {
          active = false;
          for (const jobId of [...running.keys()]) stopWorking(jobId);
          pendingProgress.clear();
          run = null;
          stopTicker();
          const endedAt = Date.now();
          setJobs(
            get().jobs.map((j) =>
              j.status === 'waiting' || j.status === 'working'
                ? { ...j, status: 'cancelled', endedAt }
                : j,
            ),
          );
          return;
        }
        const job = get().jobs.find((j) => j.id === id);
        if (!job || (job.status !== 'waiting' && job.status !== 'working')) return;
        if (job.status === 'working') stopWorking(id);
        patchJob(id, { status: 'cancelled', endedAt: Date.now() });
        pump();
      },

      retry(id: string) {
        const job = get().jobs.find((j) => j.id === id);
        if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return;
        order.set(id, ++seq);
        patchJob(id, {
          status: 'waiting',
          progress: 0,
          error: undefined,
          result: undefined,
          startedAt: undefined,
          endedAt: undefined,
        });
        get().start();
      },

      remove(id: string) {
        const { jobs } = get();
        if (!jobs.some((j) => j.id === id)) return;
        if (running.has(id)) stopWorking(id);
        order.delete(id);
        heavy.delete(id);
        run?.ids.delete(id);
        // Dropping the job drops the only reference to its result blob.
        setJobs(jobs.filter((j) => j.id !== id));
        pump();
      },

      clear() {
        active = false;
        for (const jobId of [...running.keys()]) stopWorking(jobId);
        pendingProgress.clear();
        order.clear();
        heavy.clear();
        run = null;
        stopTicker();
        setJobs([]);
      },
    };
  });
}
