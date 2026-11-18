// Messages between a caller (the image worker) and the RAW worker. Plain data only.

import type { RawOptions } from '@/core/contracts/image';
import type { RawInfo } from '@/core/contracts/raw';

/** Everything known about a RAW file without decoding pixels. */
export interface RawFileInfo extends RawInfo {
  /** Container format ("CR3", "NEF" …) or the file extension when no decoder knows it. */
  format: string;
  decoder: 'flashraw' | 'libraw';
  /** Embedded images with what's needed to pick one (index for FlashRaw's preview()). */
  embedded: Array<{
    index: number;
    width: number;
    height: number;
    encoding: string;
    orientation: number;
  }>;
  /** ISO date, no fractional seconds. */
  takenAt?: string;
  hasLocation: boolean;
  /** Compact EXIF TIFF block for the output (see exif.ts). */
  exif?: ArrayBuffer;
  /** DNG BaselineExposure (stops), applied like other RAW developers do. */
  baselineExposure: number;
}

export interface DevelopRequest {
  whiteBalance: RawOptions['whiteBalance'];
  exposure: number;
  highlights: RawOptions['highlights'];
  halfSize: boolean;
  /** Tests and comparisons: develop with LibRaw even when FlashRaw can. */
  decoder?: 'libraw';
}

export interface DevelopResult {
  info: RawFileInfo;
  /** Upright RGBA, sRGB. */
  pixels: ArrayBuffer;
  width: number;
  height: number;
}

export interface PreviewResult {
  info: RawFileInfo;
  jpeg: ArrayBuffer;
  width: number;
  height: number;
  /** EXIF orientation to apply to the JPEG's stored pixels. */
  orientation: number;
}

export type RawRequest =
  | { id: number; op: 'info'; file: Blob }
  | { id: number; op: 'preview'; file: Blob; index?: number }
  | { id: number; op: 'develop'; file: Blob; options: DevelopRequest }
  /** Diagnostics: how FlashRaw was loaded in this worker (tests). */
  | { id: number; op: 'status' };

/** Answer to `status`: FlashRaw's threads (0 = one thread) and how they were started. */
export interface RawWorkerStatus {
  threads: number;
  threadStart?: 'direct' | 'blob';
}

/**
 * Why a request failed. `unavailable`: the RAW worker couldn't start (its script didn't load, or it
 * stopped while no develop was running); never treated as a memory problem.
 */
export type RawErrorKind = 'unsupported' | 'damaged' | 'out-of-memory' | 'unavailable';

export interface RawFailure {
  kind: RawErrorKind;
  /** For 'unsupported': brand and format, e.g. "Sigma X3F", when known. */
  format?: string;
  detail?: string;
}

/** Sent once by the RAW worker when its script has loaded, before any response. */
export interface RawReady {
  type: 'ready';
}

export type RawResponse =
  | {
      id: number;
      ok: true;
      result: RawFileInfo | PreviewResult | DevelopResult | RawWorkerStatus | null;
    }
  | { id: number; ok: false; error: RawFailure };
