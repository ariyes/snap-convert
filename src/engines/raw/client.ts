// Talks to the RAW worker. One worker at a time per caller: kept while it is cheap (reading
// details and camera JPEGs) and closed after every develop, which gives its WebAssembly memory
// back. Develops are also queued across all of this page's workers with a Web Lock, so a batch of
// RAW files never holds several full-size develops in memory at once.

import type {
  DevelopRequest,
  DevelopResult,
  PreviewResult,
  RawFailure,
  RawFileInfo,
  RawRequest,
  RawResponse,
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
/** Name of the Web Lock that lets one develop run at a time. */
export const DEVELOP_LOCK = 'snap-convert-raw-develop';

/** A request without its id (distributes over the union). */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type RequestBody = WithoutId<RawRequest>;

type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void };

class RawWorkerConnection {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  closed = false;

  constructor() {
    this.worker = new Worker(new URL('./raw.worker.ts', import.meta.url), {
      type: 'module',
      name: 'snap-convert-raw',
    });
    this.worker.addEventListener('message', (event: MessageEvent<RawResponse>) => {
      const response = event.data;
      const p = this.pending.get(response.id);
      if (!p) return;
      this.pending.delete(response.id);
      if (response.ok) p.resolve(response.result);
      else p.reject(new RawWorkerError(response.error));
    });
    // A worker that dies (out of memory, failed to load) rejects everything it was doing.
    const crash = (detail: string) => {
      this.close(new RawWorkerError({ kind: 'out-of-memory', detail }));
    };
    this.worker.addEventListener('error', (event) => {
      event.preventDefault();
      crash(event.message || 'RAW worker failed');
    });
    this.worker.addEventListener('messageerror', () => crash('RAW worker message failed'));
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  call<T>(request: RequestBody): Promise<T> {
    if (this.closed) return Promise.reject(new RawWorkerError({ kind: 'out-of-memory' }));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  close(error?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      p.reject(error ?? new RawWorkerError({ kind: 'out-of-memory', detail: 'RAW worker closed' }));
    }
    this.pending.clear();
  }
}

let shared: RawWorkerConnection | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

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

async function run<T>(request: RequestBody, closeAfter: boolean): Promise<T> {
  const conn = connection();
  try {
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
