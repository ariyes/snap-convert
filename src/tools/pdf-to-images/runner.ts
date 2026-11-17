// Runs "save these pages" one page at a time per slot: each page is drawn (pdf.js, at most 2 at
// once across the app) and then encoded as an image job on the shared queue. Only a few pages are
// in flight at once, so a 300-page PDF never holds more than a handful of rendered pages in memory.
// Pure (the work is passed in), so it is tested without pdf.js or workers.

export type PageStatus = 'waiting' | 'rendering' | 'encoding' | 'done' | 'failed' | 'cancelled';

export interface PageTask<R> {
  /** 1-based page number. */
  page: number;
  status: PageStatus;
  /** 0–1. */
  progress: number;
  result?: R;
  /** User-readable, when failed. */
  error?: string;
}

export interface PageWorkContext {
  signal: AbortSignal;
  stage: (stage: 'rendering' | 'encoding') => void;
  progress: (p: number) => void;
}

/** Draws and encodes one page. Rejects when it fails; when aborted, rejects with anything. */
export type PageWork<R> = (page: number, ctx: PageWorkContext) => Promise<R>;

export interface RunnerOptions {
  /** Pages in flight at once (drawn or being encoded). */
  concurrency: number;
  /** The user-readable message for a failure. */
  describeError(error: unknown): string;
}

type Listener<R> = (tasks: ReadonlyArray<PageTask<R>>) => void;

export class PageRunner<R> {
  #tasks: ReadonlyArray<PageTask<R>> = [];
  readonly #pending: number[] = [];
  readonly #controllers = new Map<number, AbortController>();
  readonly #listeners = new Set<Listener<R>>();
  #active = 0;
  #disposed = false;
  /** Bumped by every start(): pages still settling from an earlier run never touch this one. */
  #generation = 0;

  constructor(
    private readonly work: PageWork<R>,
    private readonly options: RunnerOptions,
  ) {}

  get tasks(): ReadonlyArray<PageTask<R>> {
    return this.#tasks;
  }

  /** Pages currently drawn or encoded (tests). */
  get active(): number {
    return this.#active;
  }

  subscribe(listener: Listener<R>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Saves these pages (1-based), in order. */
  start(pages: readonly number[]): void {
    if (this.#disposed) return;
    this.cancel();
    this.#generation++;
    this.#tasks = pages.map((page) => ({ page, status: 'waiting', progress: 0 }));
    this.#pending.splice(0, this.#pending.length, ...pages);
    this.#emit();
    this.#pump();
  }

  /** Stops every page still waiting, drawing or encoding. Finished pages are kept. */
  cancel(): void {
    for (const controller of this.#controllers.values()) controller.abort();
    const waiting = new Set(this.#pending.splice(0));
    if (waiting.size > 0) {
      this.#update((t) => (waiting.has(t.page) ? { ...t, status: 'cancelled', progress: 0 } : t));
    }
  }

  /** Runs a failed or stopped page again. */
  retry(page: number): void {
    if (this.#disposed) return;
    const task = this.#tasks.find((t) => t.page === page);
    if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) return;
    this.#update((t) => (t.page === page ? { page, status: 'waiting', progress: 0 } : t));
    this.#pending.push(page);
    this.#pump();
  }

  /** Runs every failed or stopped page again. */
  retryAll(): void {
    for (const t of this.#tasks) {
      if (t.status === 'failed' || t.status === 'cancelled') this.retry(t.page);
    }
  }

  /** Cancels everything and stops reporting (the page was left or a new run replaced this one). */
  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
    this.cancel();
  }

  #pump(): void {
    while (!this.#disposed && this.#active < this.options.concurrency && this.#pending.length > 0) {
      const page = this.#pending.shift()!;
      this.#active++;
      void this.#run(page, this.#generation).finally(() => {
        this.#active--;
        this.#pump();
      });
    }
  }

  async #run(page: number, generation: number): Promise<void> {
    const controller = new AbortController();
    this.#controllers.set(page, controller);
    const { signal } = controller;
    const current = () => generation === this.#generation;
    const set = (patch: Partial<PageTask<R>>) => {
      if (!signal.aborted && current()) {
        this.#update((t) => (t.page === page ? { ...t, ...patch } : t));
      }
    };
    try {
      set({ status: 'rendering', progress: 0 });
      const result = await this.work(page, {
        signal,
        stage: (status) => set({ status }),
        progress: (p) => set({ progress: Math.min(1, Math.max(0, p)) }),
      });
      if (signal.aborted) throw signal.reason;
      set({ status: 'done', progress: 1, result });
    } catch (error) {
      if (!current()) return;
      const status = signal.aborted ? 'cancelled' : 'failed';
      const message = status === 'failed' ? this.options.describeError(error) : undefined;
      this.#update((t) =>
        t.page === page
          ? { page, status, progress: 0, ...(message === undefined ? {} : { error: message }) }
          : t,
      );
    } finally {
      if (this.#controllers.get(page) === controller) this.#controllers.delete(page);
    }
  }

  #update(map: (task: PageTask<R>) => PageTask<R>): void {
    if (this.#disposed) return;
    this.#tasks = this.#tasks.map(map);
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#tasks);
  }
}

/** How many pages are done, and overall progress (0–1). */
export function runStats<R>(tasks: ReadonlyArray<PageTask<R>>): {
  total: number;
  done: number;
  failed: number;
  stopped: number;
  running: boolean;
  progress: number;
} {
  let done = 0;
  let failed = 0;
  let stopped = 0;
  let running = false;
  let sum = 0;
  for (const t of tasks) {
    if (t.status === 'done') done++;
    else if (t.status === 'failed') failed++;
    else if (t.status === 'cancelled') stopped++;
    else running = true;
    sum += t.status === 'done' ? 1 : t.progress;
  }
  return {
    total: tasks.length,
    done,
    failed,
    stopped,
    running,
    progress: tasks.length > 0 ? sum / tasks.length : 0,
  };
}
