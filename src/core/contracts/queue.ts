// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.

export type JobKind = 'image' | 'pdf';
export type JobStatus = 'waiting' | 'working' | 'done' | 'failed' | 'cancelled';

export interface Job<I = unknown, R = unknown> {
  id: string;
  kind: JobKind;
  op: string;                     // e.g. 'process' (image) or 'merge' | 'split' … (pdf)
  label: string;                  // shown in the UI (usually the file name)
  input: I;
  status: JobStatus;
  progress: number;               // 0–1
  result?: R;
  error?: string;                 // user-readable
  startedAt?: number;
  endedAt?: number;
}

export interface QueueStats {
  total: number; waiting: number; working: number; done: number; failed: number;
  etaSeconds: number | null;      // null until there's enough data (IMG-08 time left)
}

/** What every worker exposes through Comlink. */
export interface WorkerApi {
  run(op: string, input: unknown, onProgress: (p: number) => void): Promise<unknown>;
}

export interface QueueApi {
  add<I>(kind: JobKind, op: string, items: Array<{ label: string; input: I }>): string[];
  start(): void;
  cancel(id?: string): void;      // no id = cancel all
  retry(id: string): void;
  remove(id: string): void;
  clear(): void;
}
// Exposed as a Zustand store: useQueue() → { jobs: Job[]; stats: QueueStats } & QueueApi
