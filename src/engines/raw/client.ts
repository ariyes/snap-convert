// Talks to the RAW worker. One worker at a time per caller: kept while it is cheap (reading
// details and camera JPEGs) and closed after every develop, which gives its WebAssembly memory
// back. Develops are also queued across all of this page's workers with a Web Lock, so a batch of
// RAW files never holds several full-size develops in memory at once.
//
// Starting: the worker says "ready" once its script runs. A worker that fails before that didn't
// start: some browsers can't load any worker started from inside a worker (the Claude desktop
// app's Chromium 156 browser never even requests the script). Inside a worker (the image worker)
// the RAW engine then runs right here instead, for the rest of this worker's life; on the page
// itself it doesn't (heavy work stays off the main thread) and requests fail as `unavailable`.
// `unavailable` is never treated as out of memory: only a worker dying during a develop is
// (index.ts retries that at half size).

import type {
  DevelopRequest,
  DevelopResult,
  PreviewResult,
  RawFailure,
  RawFileInfo,
  RawReady,
  RawRequest,
  RawResponse,
  RawWorkerStatus,
} from './protocol';

/** A RAW worker request that failed; `failure.kind` says why. */
export class RawWorkerError extends Error {
  constructor(readonly failure: RawFailure) {
    super(failure.detail ?? failure.kind);
    this.name = 'RawWorkerError';
  }
}

/** Idle RAW workers are closed after this long. */
export const RAW_WORKER_IDLE_MS = 10_000;
/** A worker that hasn't said "ready" by then didn't start. Its script is small (decoders load later). */
export const RAW_WORKER_START_MS = 30_000;
/** Name of the Web Lock that lets one develop run at a time. */
export const DEVELOP_LOCK = 'snap-convert-raw-develop';

/** A request without its id (distributes over the union). */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type RequestBody = WithoutId<RawRequest>;

type Pending = {
  op: RawRequest['op'];
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

/** Where RAW requests run: a RAW worker of their own, or (fallback) the calling worker itself. */
export type RawEngineMode = 'worker' | 'in-process';

function isReady(data: unknown): data is RawReady {
  return typeof data === 'object' && data !== null && (data as RawReady).type === 'ready';
}

class RawWorkerConnection {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /** Calls waiting for the worker to start. */
  private waiting = 0;
  private readonly ready: Promise<void>;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  started = false;
  closed = false;
  /** Why the worker is closed, for calls made afterwards. */
  private closedWith: RawWorkerError | undefined;

  constructor() {
    let markReady!: () => void;
    let failStart!: (error: unknown) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failStart = reject;
    });
    this.ready.catch(() => undefined); // failures reach callers through call()

    this.worker = new Worker(new URL('./raw.worker.ts', import.meta.url), {
      type: 'module',
      name: 'snap-convert-raw',
    });

    const startFailed = (detail: string) => {
      const error = new RawWorkerError({ kind: 'unavailable', detail });
      failStart(error);
      this.close(error);
    };
    this.startTimer = setTimeout(
      () => startFailed(`RAW worker did not start within ${RAW_WORKER_START_MS / 1000} s`),
      RAW_WORKER_START_MS,
    );

    this.worker.addEventListener('message', (event: MessageEvent<RawResponse | RawReady>) => {
      const data = event.data;
      if (isReady(data)) {
        this.started = true;
        this.clearStart();
        markReady();
        return;
      }
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(new RawWorkerError(data.error));
    });
    const stopped = (detail: string) => {
      if (!this.started) {
        startFailed(detail || 'RAW worker failed to start');
        return;
      }
      // Died while working: during a develop that is memory running out (WebAssembly memory
      // can't grow further, or the browser killed the worker); otherwise it just stopped.
      const developing = [...this.pending.values()].some((p) => p.op === 'develop');
      this.close(
        new RawWorkerError({
          kind: developing ? 'out-of-memory' : 'unavailable',
          detail: detail || 'RAW worker stopped',
        }),
      );
    };
    this.worker.addEventListener('error', (event) => {
      event.preventDefault();
      stopped(event.message);
    });
    this.worker.addEventListener('messageerror', () => stopped('RAW worker message failed'));
  }

  private clearStart(): void {
    if (this.startTimer !== undefined) clearTimeout(this.startTimer);
    this.startTimer = undefined;
  }

  get busy(): boolean {
    return this.pending.size > 0 || this.waiting > 0;
  }

  async call<T>(request: RequestBody): Promise<T> {
    this.waiting += 1;
    try {
      await this.ready;
    } finally {
      this.waiting -= 1;
    }
    if (this.closed) {
      throw (
        this.closedWith ?? new RawWorkerError({ kind: 'unavailable', detail: 'RAW worker closed' })
      );
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        op: request.op,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ ...request, id });
    });
  }

  close(error?: RawWorkerError): void {
    if (this.closed) return;
    this.closed = true;
    this.closedWith = error;
    this.clearStart();
    this.worker.terminate();
    const reason =
      error ?? new RawWorkerError({ kind: 'unavailable', detail: 'RAW worker closed' });
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
  }
}

let shared: RawWorkerConnection | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** Switches to 'in-process' for good once this worker couldn't start a RAW worker. */
let mode: RawEngineMode = 'worker';

/** Where RAW requests run here (tests, diagnostics). */
export const rawEngineMode = (): RawEngineMode => mode;

/** In a worker (not on the page), where the engine may run in-process. */
function inWorker(): boolean {
  return typeof (globalThis as { document?: unknown }).document === 'undefined';
}

function connection(): RawWorkerConnection {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  if (!shared || shared.closed) shared = new RawWorkerConnection();
  return shared;
}

function release(conn: RawWorkerConnection, closeNow: boolean): void {
  if (conn !== shared) return;
  if (closeNow && !conn.busy) {
    conn.close();
    shared = undefined;
    return;
  }
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (shared && !shared.busy) {
      shared.close();
      shared = undefined;
    }
  }, RAW_WORKER_IDLE_MS);
}

/**
 * The RAW worker's work, done in this worker instead (same engine, same answers and failures).
 * WebAssembly memory isn't given back here until this worker closes, so it is only the fallback.
 */
async function runHere<T>(request: RequestBody): Promise<T> {
  const engine = await import('./engine');
  try {
    switch (request.op) {
      case 'info':
        return (await engine.inspect(request.file)) as T;
      case 'preview':
        return (await engine.preview(request.file, request.index)) as T;
      case 'develop':
        return (await engine.develop(request.file, request.options)) as T;
      case 'status': {
        const { flashRawLoadInfo } = await import('./flashraw');
        const status: RawWorkerStatus = { ...flashRawLoadInfo(), inProcess: true };
        return status as T;
      }
    }
  } catch (error) {
    if (error instanceof engine.RawEngineError) throw new RawWorkerError(error.failure);
    throw new RawWorkerError({
      kind: 'damaged',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function run<T>(request: RequestBody, closeAfter: boolean): Promise<T> {
  if (mode === 'in-process') return runHere<T>(request);
  const conn = connection();
  try {
    return await conn.call<T>(request);
  } catch (error) {
    const didNotStart =
      !conn.started && error instanceof RawWorkerError && error.failure.kind === 'unavailable';
    if (!didNotStart || !inWorker()) throw error;
    // This browser can't start a worker from here: run the engine in this worker from now on.
    mode = 'in-process';
    return runHere<T>(request);
  } finally {
    release(conn, closeAfter);
  }
}

/** Runs `task` while holding the develop lock (straight away where Web Locks don't exist). */
async function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) return task();
  return locks.request(DEVELOP_LOCK, task);
}

export function rawInfo(file: Blob): Promise<RawFileInfo> {
  return run<RawFileInfo>({ op: 'info', file }, false);
}

export function rawPreview(file: Blob, index?: number): Promise<PreviewResult | null> {
  return run<PreviewResult | null>({ op: 'preview', file, index }, false);
}

export function rawDevelop(file: Blob, options: DevelopRequest): Promise<DevelopResult> {
  return oneAtATime(() => run<DevelopResult>({ op: 'develop', file, options }, true));
}

/** How FlashRaw runs for this caller (tests, diagnostics). */
export function rawStatus(): Promise<RawWorkerStatus> {
  return run<RawWorkerStatus>({ op: 'status' }, false);
}

/** Closes the RAW worker now (tests; a page being torn down). */
export function closeRawWorker(): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  shared?.close();
  shared = undefined;
}

/** Tests: use a RAW worker again, as in a fresh worker. */
export function resetRawEngineMode(): void {
  mode = 'worker';
}
