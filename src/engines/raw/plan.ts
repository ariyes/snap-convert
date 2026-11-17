// What to do with a RAW file (pure, no WebAssembly): use the camera's own JPEG, or develop the
// sensor data in full or at half size. Memory figures were measured with FlashRaw 0.3.1 (peak bytes
// per sensor pixel, including the file copy inside WebAssembly and our RGBA output).

import type { RawOptions } from '@/core/contracts/image';

export const RAW_MEMORY = {
  /** Full develop (AHD demosaic to half floats) + RGBA: 13.4–13.9 B per sensor pixel measured. */
  fullBytesPerPixel: 14,
  /** Half-size develop (2×2 binning) + RGBA: 5.8–6.5 B per sensor pixel measured. */
  halfBytesPerPixel: 6.5,
  /** iPhone / iPad and other phones: keep the RAW decode's peak under this (governor's brief). */
  phoneBudget: 300_000_000,
  /** Low-memory computers (deviceMemory ≤ 4 GB). */
  lowMemoryBudget: 800_000_000,
  /** Everything else (a 100 MP full develop needs ~1.4 GB). */
  desktopBudget: 2_000_000_000,
} as const;

/** The camera JPEG is used in fast mode when its long side is at least this share of the image's. */
export const PREVIEW_MIN_SHARE = 0.9;

/** Half-size develops are used for small outputs when they keep at least this multiple of the output's long side. */
export const HALF_SIZE_HINT_FACTOR = 2;

export const DEFAULT_RAW_OPTIONS: RawOptions = {
  mode: 'fast',
  whiteBalance: 'as-shot',
  exposure: 0,
  highlights: 'clip',
};

/** Fills in defaults and keeps exposure inside −2…+2 stops (anything unreadable becomes 0). */
export function normalizeRawOptions(o: Partial<RawOptions> | undefined): RawOptions {
  const exposure = typeof o?.exposure === 'number' && Number.isFinite(o.exposure) ? o.exposure : 0;
  return {
    mode: o?.mode === 'full' ? 'full' : 'fast',
    whiteBalance: o?.whiteBalance === 'auto' ? 'auto' : 'as-shot',
    exposure: Math.max(-2, Math.min(2, exposure)),
    highlights: o?.highlights === 'recover' ? 'recover' : 'clip',
  };
}

export interface MemoryEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** navigator.deviceMemory (GB, Chromium only). */
  deviceMemory?: number;
}

export function readMemoryEnv(): MemoryEnv {
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number });
  return {
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    deviceMemory: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : undefined,
  };
}

/** Bytes a RAW decode may use on this device. iPadOS reports a Mac user agent, so touch decides there. */
export function memoryBudget(env: MemoryEnv = readMemoryEnv()): number {
  const ua = env.userAgent;
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  const phone = apple || /Android|Mobile/.test(ua);
  if (phone) return RAW_MEMORY.phoneBudget;
  if (env.deviceMemory !== undefined && env.deviceMemory <= 4) return RAW_MEMORY.lowMemoryBudget;
  return RAW_MEMORY.desktopBudget;
}

/** Estimated peak bytes of developing a `width` × `height` sensor from a `fileBytes` file. */
export function developBytes(
  width: number,
  height: number,
  fileBytes: number,
  halfSize: boolean,
): number {
  const perPixel = halfSize ? RAW_MEMORY.halfBytesPerPixel : RAW_MEMORY.fullBytesPerPixel;
  return width * height * perPixel + fileBytes;
}

export interface PreviewChoice {
  index: number;
  width: number;
  height: number;
}

/** The largest embedded JPEG whose long side is at least {@link PREVIEW_MIN_SHARE} of the image's. */
export function fullSizePreview(
  image: { width: number; height: number },
  previews: ReadonlyArray<{ index: number; width: number; height: number; encoding: string }>,
): PreviewChoice | undefined {
  const longest = Math.max(image.width, image.height);
  const jpegs = previews
    .filter((p) => p.encoding === 'jpeg' && p.width > 0 && p.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const best = jpegs[0];
  if (!best || Math.max(best.width, best.height) < PREVIEW_MIN_SHARE * longest) return undefined;
  return { index: best.index, width: best.width, height: best.height };
}

export type RawPlan =
  | { use: 'preview'; preview: PreviewChoice }
  | {
      use: 'develop';
      halfSize: boolean;
      /** Why half size: it fits this device's memory ('memory', note raw-half-size) or the output is small ('hint'). */
      reason?: 'memory' | 'hint';
    };

export interface PlanInput {
  mode: RawOptions['mode'];
  image: { width: number; height: number };
  previews: ReadonlyArray<{ index: number; width: number; height: number; encoding: string }>;
  fileBytes: number;
  budget: number;
  /** The output's longest side, when known before decoding (pipeline decode hint). */
  minLongestSide?: number;
  /** Already failed once at full size (out of memory): develop at half size. */
  forceHalf?: boolean;
}

export function planRaw(p: PlanInput): RawPlan {
  if (p.mode === 'fast') {
    const preview = fullSizePreview(p.image, p.previews);
    if (preview) return { use: 'preview', preview };
  }
  const { width, height } = p.image;
  if (p.forceHalf || developBytes(width, height, p.fileBytes, false) > p.budget) {
    return { use: 'develop', halfSize: true, reason: 'memory' };
  }
  const halfLongest = Math.floor(Math.max(width, height) / 2);
  if (p.minLongestSide && p.minLongestSide * HALF_SIZE_HINT_FACTOR <= halfLongest) {
    return { use: 'develop', halfSize: true, reason: 'hint' };
  }
  return { use: 'develop', halfSize: false };
}
