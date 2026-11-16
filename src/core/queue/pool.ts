// Worker pool: workers are created lazily, reused while warm, terminated after a quiet minute,
// and replaced when they crash, run out of memory or are cancelled mid-job.

import * as Comlink from 'comlink';
import type { JobKind, WorkerApi } from '@/core/contracts';
import { computePoolSize, readDevice } from './device';
import { isOutOfMemoryError } from './errors';
import type { WorkerRegistry } from './registry';

/** An idle worker is terminated after this long. */
export const IDLE_TIMEOUT_MS = 60_000;

/** How a run on the pool ended. */
export type RunOutcome =
  | { type: 'done'; value: unknown }
  /** The worker threw (not out of memory). The worker stays in the pool. */
  | { type: 'error'; error: unknown }
  /** Out of memory, or the worker crashed after it had started. The worker was replaced. */
  | { type: 'crash' }
  /** The worker never started (script failed to download or to run). Its slot was freed. */
  | { type: 'load-failed'; error?: unknown }
  /** No worker could be created for this kind. */
  | { type: 'unavailable'; error: unknown }
  /** The signal was aborted. The worker was terminated and will be replaced on demand. */
  | { type: 'aborted' };

export interface WorkerPoolOptions {
  registry: WorkerRegistry;
  /** Max live workers. Default: from the device (see computePoolSize), read on first use. */
  size?: number | (() => number);
  idleMs?: number;
}

export interface PoolStats {
  /** Workers alive now (busy + idle). */
  live: number;
  busy: number;
  idle: number;
  /** Workers being created right now. */
  starting: number;
  /** Totals since the pool was made. */
  created: number;
  terminated: number;
}

interface PooledWorker {
  kind: JobKind;
  worker: Worker;
  api: Comlink.Remote<WorkerApi>;
  busy: boolean;
  /** The worker answered the readiness handshake: its script loaded and Comlink is listening. */
  ready: boolean;
  /** Set when the worker can't be trusted any more; it is terminated instead of kept warm. */
  broken: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Ends the current run early (crash / unreadable message). */
  onFailure: ((outcome: RunOutcome) => void) | null;
}

export class WorkerPool {
  private readonly registry: WorkerRegistry;
  private readonly sizeOption: number | (() => number) | undefined;
  private resolvedSize: number | null = null;
  private readonly idleMs: number;
  private readonly workers = new Set<PooledWorker>();
  private starting = 0;
  private created = 0;
  private terminated = 0;

  constructor(options: WorkerPoolOptions) {
    this.registry = options.registry;
    this.sizeOption = options.size;
    this.idleMs = options.idleMs ?? IDLE_TIMEOUT_MS;
  }

  /** Max workers alive at once (and so max jobs in parallel). Worked out on first use. */
  get size(): number {
    if (this.resolvedSize === null) {
      const opt = this.sizeOption;
      const raw = typeof opt === 'function' ? opt() : (opt ?? computePoolSize(readDevice()));
      this.resolvedSize = Math.max(1, Math.floor(raw));
    }
    return this.resolvedSize;
  }

  stats(): PoolStats {
    let busy = 0;
    for (const w of this.workers) if (w.busy) busy++;
    return {
      live: this.workers.size,
      busy,
      idle: this.workers.size - busy,
      starting: this.starting,
      created: this.created,
      terminated: this.terminated,
    };
  }

  /**
   * Runs `op` on a worker of `kind`. Never rejects: every way a run can end is an outcome.
   * Aborting `signal` terminates the worker straight away.
   */
  async run(
    kind: JobKind,
    op: string,
    input: unknown,
    onProgress: (p: number) => void,
    signal?: AbortSignal,
  ): Promise<RunOutcome> {
    if (signal?.aborted) return { type: 'aborted' };
    let pw: PooledWorker;
    try {
      pw = await this.acquire(kind);
    } catch (error) {
      return { type: 'unavailable', error };
    }
    if (signal?.aborted) {
      this.release(pw);
      return { type: 'aborted' };
    }

    return new Promise<RunOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: RunOutcome) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        pw.onFailure = null;
        // Free or replace the worker before the caller continues, so the next job sees the slot.
        const keep = (outcome.type === 'done' || outcome.type === 'error') && !pw.broken;
        if (keep) this.release(pw);
        else this.discard(pw);
        resolve(outcome);
      };
      const onAbort = () => settle({ type: 'aborted' });
      signal?.addEventListener('abort', onAbort, { once: true });
      pw.onFailure = settle;

      const ready = pw.ready ? Promise.resolve() : this.handshake(pw);
      ready.then(
        () => {
          if (settled) return;
          pw.api.run(op, input, Comlink.proxy(onProgress)).then(
            (value) => settle({ type: 'done', value }),
            (error: unknown) =>
              settle(isOutOfMemoryError(error) ? { type: 'crash' } : { type: 'error', error }),
          );
        },
        (error: unknown) => settle({ type: 'load-failed', error }),
      );
    });
  }

  /**
   * Readiness handshake, done once per worker before its first job. Reads `run.length` through
   * Comlink: one GET round-trip that only succeeds once the worker's script has loaded and
   * `Comlink.expose` has run, and needs nothing extra from the engine workers (WorkerApi is
   * unchanged). Until it answers, a worker `error` event means "failed to load", not "crashed".
   */
  private async handshake(pw: PooledWorker): Promise<void> {
    const probe = pw.api.run as unknown as { readonly length: PromiseLike<number> };
    await probe.length;
    pw.ready = true;
  }

  /** Terminates every worker (e.g. when the page is torn down). */
  dispose(): void {
    for (const pw of [...this.workers]) this.discard(pw);
  }

  private async acquire(kind: JobKind): Promise<PooledWorker> {
    // Synchronous part first, so two calls in a row can't take the same idle worker.
    for (const pw of this.workers) {
      if (!pw.busy && pw.kind === kind) {
        this.clearIdleTimer(pw);
        pw.busy = true;
        return pw;
      }
    }
    if (this.workers.size + this.starting >= this.size) {
      // Make room by closing a warm worker of another kind.
      for (const pw of this.workers) {
        if (!pw.busy) {
          this.discard(pw);
          break;
        }
      }
    }

    this.starting++;
    let worker: Worker;
    try {
      worker = await this.registry[kind]();
    } finally {
      this.starting--;
    }
    this.created++;
    const pw: PooledWorker = {
      kind,
      worker,
      api: Comlink.wrap<WorkerApi>(worker),
      busy: true,
      ready: false,
      broken: false,
      idleTimer: null,
      onFailure: null,
    };
    worker.addEventListener('error', (event) => {
      // Handled here: a failed load, an uncaught error or a crash. Don't report it to the page.
      event.preventDefault();
      pw.broken = true;
      if (pw.onFailure) pw.onFailure(pw.ready ? { type: 'crash' } : { type: 'load-failed' });
      else this.discard(pw);
    });
    worker.addEventListener('messageerror', () => {
      pw.broken = true;
      if (pw.onFailure) pw.onFailure({ type: 'error', error: undefined });
      else this.discard(pw);
    });
    this.workers.add(pw);
    return pw;
  }

  private release(pw: PooledWorker): void {
    if (!this.workers.has(pw)) return;
    pw.busy = false;
    this.clearIdleTimer(pw);
    pw.idleTimer = setTimeout(() => this.discard(pw), this.idleMs);
  }

  private discard(pw: PooledWorker): void {
    this.clearIdleTimer(pw);
    if (!this.workers.delete(pw)) return;
    pw.worker.terminate();
    this.terminated++;
  }

  private clearIdleTimer(pw: PooledWorker): void {
    if (pw.idleTimer !== null) {
      clearTimeout(pw.idleTimer);
      pw.idleTimer = null;
    }
  }
}
