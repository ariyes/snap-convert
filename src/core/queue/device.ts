// Device limits for the worker pool (docs/05-architecture.md, key choice 4 and "Device limits").

export interface DeviceInfo {
  /** navigator.hardwareConcurrency (0 or undefined when the browser hides it). */
  cores?: number;
  /** matchMedia('(pointer: coarse)') — a touch screen is the main pointer. */
  coarsePointer: boolean;
  /** Viewport width in CSS pixels. */
  viewportWidth: number;
  /** navigator.deviceMemory in GB (Chromium only, capped at 8). */
  deviceMemory?: number;
}

export const POOL_LIMITS = {
  /** Fallback when hardwareConcurrency is unknown. */
  defaultCores: 2,
  maxWorkers: 8,
  phoneMaxWorkers: 2,
  /** Coarse pointer and narrower than this counts as a phone. */
  phoneMaxWidth: 880,
  /** deviceMemory at or below this counts as a phone. */
  lowMemoryGb: 4,
} as const;

/** A job over either limit runs alone. */
export const HEAVY_LIMITS = {
  megapixels: 40,
  bytes: 100 * 1024 * 1024,
} as const;

export function isPhoneLike(d: DeviceInfo): boolean {
  const smallTouch = d.coarsePointer && d.viewportWidth < POOL_LIMITS.phoneMaxWidth;
  const lowMemory = d.deviceMemory !== undefined && d.deviceMemory <= POOL_LIMITS.lowMemoryGb;
  return smallTouch || lowMemory;
}

/** min(cores || 2, 8); phones at most 2; never below 1. */
export function computePoolSize(d: DeviceInfo): number {
  const cores = d.cores && d.cores > 0 ? Math.floor(d.cores) : POOL_LIMITS.defaultCores;
  const size = Math.min(cores, POOL_LIMITS.maxWorkers);
  const capped = isPhoneLike(d) ? Math.min(size, POOL_LIMITS.phoneMaxWorkers) : size;
  return Math.max(1, capped);
}

function matchesCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Reads the current device. Safe to call during prerender (no window / navigator). */
export function readDevice(): DeviceInfo {
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number });
  const hasWindow = typeof window !== 'undefined';
  return {
    cores: nav?.hardwareConcurrency,
    coarsePointer: hasWindow && matchesCoarsePointer(),
    viewportWidth: hasWindow ? window.innerWidth : Number.POSITIVE_INFINITY,
    deviceMemory: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : undefined,
  };
}

const MAX_DEPTH = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Total bytes of the Blobs and buffers inside a job input (plain objects and arrays, a few levels deep). */
export function inputBytes(input: unknown, depth = 0): number {
  if (typeof Blob !== 'undefined' && input instanceof Blob) return input.size;
  if (input instanceof ArrayBuffer) return input.byteLength;
  if (ArrayBuffer.isView(input)) return input.byteLength;
  if (typeof ImageData !== 'undefined' && input instanceof ImageData) return input.data.byteLength;
  if (depth >= MAX_DEPTH) return 0;
  if (Array.isArray(input)) {
    return input.reduce<number>((sum, item) => sum + inputBytes(item, depth + 1), 0);
  }
  if (isPlainObject(input)) {
    return Object.values(input).reduce<number>((sum, v) => sum + inputBytes(v, depth + 1), 0);
  }
  return 0;
}

/**
 * Megapixels of a job input, when the caller knows them: numeric `width` and `height`
 * on the input itself (e.g. copied from IntakeFile). `null` when unknown.
 */
export function inputMegapixels(input: unknown): number | null {
  if (!isPlainObject(input)) return null;
  const { width, height } = input;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return (width * height) / 1_000_000;
}

/** Over 40 megapixels or 100 MB → the job runs alone. */
export function isHeavyInput(
  input: unknown,
  limits: { megapixels: number; bytes: number } = HEAVY_LIMITS,
): boolean {
  const mp = inputMegapixels(input);
  if (mp !== null && mp > limits.megapixels) return true;
  return inputBytes(input) > limits.bytes;
}
