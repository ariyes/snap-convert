// Talks to the RAW worker. One worker at a time per caller: kept while it is cheap (reading
// details and camera JPEGs) and closed after every develop, which gives its WebAssembly memory
// back. Develops are also queued across all of this page's workers with a Web Lock, so a batch of
// RAW files never holds several full-size develops in memory at once.
//
// Starting: the worker says "ready" once its script runs. A worker that fails before that (its
// script couldn't be fetched, as happens to nested workers in some browsers) is started once more
// from a blob: module that imports the same script (worker-url.ts); if that fails too, requests
// fail as `unavailable`, never as out of memory. A worker that dies after starting while a develop
// runs is out of memory (the half-size retry in index.ts handles it).

import type {
  DevelopRequest,
  DevelopResult,
  PreviewResult,
  RawFailure,
  RawFileInfo,
  RawReady,
  RawRequest,
  RawResponse,
} from './protocol';
import { bootstrapWorkerUrl } from './worker-url';

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

/** How the RAW worker is started: from its URL, or from a blob that imports it. */
export type RawWorkerStart = 'direct' | 'blob';

type WorkerConstructor = new (url: string | URL, options?: WorkerOptions) => Worker;

/** Worker, but started from a blob: module that imports the script (see worker-url.ts). */
function blobWorker(remember: (url: string) => void): WorkerConstructor {
  return class extends Worker {
    constructor(url: string | URL, options?: WorkerOptions) {
      const boot = bootstrapWorkerUrl(url);
      super(boot, options);
      remember(boot);
    }
  };
}

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
  private bootUrl: string | undefined;
  started = false;
  closed = false;
  /** Why the worker is closed, for calls made afterwards. */
  private closedWith: RawWorkerError | undefined;

  constructor(readonly start: RawWorkerStart) {
    let markReady!: () => void;
    let failStart!: (error: unknown) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failStart = reject;
    });
    this.ready.catch(() => undefined); // failures reach callers through call()

    // The parameter shadows the global so the bundler still sees `new Worker(new URL(…))` and
    // builds the worker; with 'blob' the same bundled URL is started through a blob module.
    const spawn = (Worker: WorkerConstructor) =>
      new Worker(new URL('./raw.worker.ts', import.meta.url), {
        type: 'module',
        name: 'snap-convert-raw',
      });
    this.worker =
      start === 'blob'
        ? spawn(
            blobWorker((url) => {
              this.bootUrl = url;
            }),
          )
        : spawn(Worker);

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
        startFailed(detail);
        return;
      }
      // Died while working: during a develop that is memory running out (WebAssembly memory
      // can't grow further, or the browser killed the worker); otherwise it just stopped.
      const developing = [...this.pending.values()].some((p) => p.op === 'develop');
      this.close(
        new RawWorkerError({ kind: developing ? 'out-of-memory' : 'unavailable', detail }),
      );
    };
    this.worker.addEventListener('error', (event) => {
      event.preventDefault();
      stopped(event.message || 'RAW worker failed');
    });
    this.worker.addEventListener('messageerror', () => stopped('RAW worker message failed'));
  }

  private clearStart(): void {
    if (this.startTimer !== undefined) clearTimeout(this.startTimer);
    this.startTimer = undefined;
    if (this.bootUrl !== undefined) URL.revokeObjectURL(this.bootUrl);
    this.bootUrl = undefined;
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
/** Switches to 'blob' for good once this context couldn't start the worker from its URL. */
let startMode: RawWorkerStart = 'direct';

/** How new RAW workers are started here (tests, diagnostics). */
export const rawWorkerStart = (): RawWorkerStart => startMode;

function connection(): RawWorkerConnection {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  if (!shared || shared.closed) shared = new RawWorkerConnection(startMode);
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

const startFailure = (error: unknown) =>
  error instanceof RawWorkerError && error.failure.kind === 'unavailable';

async function run<T>(request: RequestBody, closeAfter: boolean): Promise<T> {
  let conn = connection();
  try {
    return await conn.call<T>(request);
  } catch (error) {
    // Couldn't start from its URL: once more from a blob that imports it.
    if (conn.started || conn.start !== 'direct' || !startFailure(error)) throw error;
    startMode = 'blob';
    release(conn, true);
    conn = connection();
    return await conn.call<T>(request);
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

/** Closes the RAW worker now (tests; a page being torn down). */
export function closeRawWorker(): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  shared?.close();
  shared = undefined;
}

/** Tests: start from the URL again, as on a fresh page. */
export function resetRawWorkerStart(): void {
  startMode = 'direct';
}
