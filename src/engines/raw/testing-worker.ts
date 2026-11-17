// Test-only worker: runs RAW decodes the way the image worker does (decodeImageWith in a worker,
// which starts the RAW worker from there) and sends back small summaries instead of 100 MB of
// pixels, so heavy work stays off the test page's main thread. Used by raw.browser.test.ts and the
// RAW quality test.
import * as Comlink from 'comlink';
import type { RawOptions } from '@/core/contracts/image';
import { DecodeError, decodeImageWith } from '@/engines/image/decode';
import { orientPixels } from '@/engines/image/decode/orientation';
import { rawDevelop } from './client';
import { decodeRawImage, extractRawPreview, readRawInfo, RawDecodeError } from './index';
import type { DevelopRequest, DevelopResult } from './protocol';
import { RawWorkerError } from './client';
import { labGrid, type Lab } from './testing';

export interface PixelSummary {
  width: number;
  height: number;
  /** FNV-1a of the RGBA bytes: equal pictures, equal hash. */
  hash: number;
  /** Hash of the pixels turned by `orient` (when asked). */
  orientedHash?: number;
  /** Luma standard deviation: a blank result is ~0. */
  lumaStdDev: number;
  meanLuma: number;
  /** 48 × 32 grid of mean Lab colours. */
  lab: Lab[];
  /** Downscaled copy (long side ≤ 600) for SSIM and looking at. */
  thumb: ImageData;
}

export interface DecodeSummary extends PixelSummary {
  ok: true;
  ms: number;
  notes: string[];
  sourceFormat: string;
  orientation: number;
  camera?: string;
  takenAt?: string;
  hasLocation: boolean;
  exifBytes?: number;
  reducedFrom?: { width: number; height: number };
}

export interface DecodeFailure {
  ok: false;
  message: string;
  code?: string;
}

function fnv(data: Uint8ClampedArray): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

async function summarise(pixels: ImageData, orient?: number): Promise<PixelSummary> {
  const { width, height, data } = pixels;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    const l = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    sum += l;
    sq += l * l;
    n++;
  }
  const mean = sum / n;
  const scale = Math.min(1, 600 / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));
  const bitmap = await createImageBitmap(pixels, {
    resizeWidth: tw,
    resizeHeight: th,
    resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const summary: PixelSummary = {
    width,
    height,
    hash: fnv(data),
    lumaStdDev: Math.sqrt(Math.max(0, sq / n - mean * mean)),
    meanLuma: mean,
    lab: labGrid(pixels, 48, 32),
    thumb: ctx.getImageData(0, 0, tw, th),
  };
  if (orient) summary.orientedHash = fnv(orientPixels(pixels, orient).data);
  return summary;
}

function failure(error: unknown): DecodeFailure {
  if (error instanceof DecodeError || error instanceof RawDecodeError) {
    return { ok: false, message: error.message, code: error.code };
  }
  return { ok: false, message: error instanceof Error ? error.message : String(error) };
}

async function decode(
  file: Blob,
  raw: Partial<RawOptions> | undefined,
  o: { budget?: number; orient?: number; minLongestSide?: number; failFullOnce?: boolean } = {},
): Promise<DecodeSummary | DecodeFailure> {
  const notes: string[] = [];
  const start = performance.now();
  try {
    let image;
    if (o.failFullOnce) {
      // Simulates the RAW worker running out of memory on the full-size develop.
      let failed = false;
      const develop = (f: Blob, request: DevelopRequest): Promise<DevelopResult> => {
        if (!request.halfSize && !failed) {
          failed = true;
          return Promise.reject(new RawWorkerError({ kind: 'out-of-memory', detail: 'simulated' }));
        }
        return rawDevelop(f, request);
      };
      const r = await decodeRawImage(file, {
        options: raw,
        budget: o.budget,
        develop,
        decodeJpeg: (jpeg, hint) => decodeImageWith(jpeg, hint),
      });
      notes.push(...r.notes);
      image = r.image;
    } else {
      const hint = o.minLongestSide ? { minLongestSide: o.minLongestSide } : undefined;
      image = await decodeImageWith(file, hint, {
        raw,
        rawMemoryBudget: o.budget,
        onNote: (note) => notes.push(note),
      });
    }
    const ms = performance.now() - start;
    const m = image.metadata;
    const summary: DecodeSummary = {
      ok: true,
      ms,
      notes,
      sourceFormat: image.sourceFormat,
      orientation: m.orientation,
      hasLocation: m.hasLocation,
      ...(await summarise(image.pixels, o.orient)),
    };
    if (m.camera) summary.camera = m.camera;
    if (m.takenAt) summary.takenAt = m.takenAt;
    if (m.exif) summary.exifBytes = m.exif.byteLength;
    if (image.reducedFrom) summary.reducedFrom = image.reducedFrom;
    return summary;
  } catch (error) {
    return failure(error);
  }
}

async function libRaw(
  file: Blob,
  request: Omit<DevelopRequest, 'decoder'>,
): Promise<PixelSummary | DecodeFailure> {
  try {
    const r = await rawDevelop(file, { ...request, decoder: 'libraw' });
    return await summarise(new ImageData(new Uint8ClampedArray(r.pixels), r.width, r.height));
  } catch (error) {
    return failure(error);
  }
}

/** The camera JPEG straight from the file, decoded by the browser with no orientation applied. */
async function preview(
  file: Blob,
): Promise<(PixelSummary & { stored: [number, number] }) | DecodeFailure | null> {
  try {
    const p = await extractRawPreview(file);
    if (!p) return null;
    const bitmap = await createImageBitmap(p.jpeg, { imageOrientation: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    return { ...(await summarise(pixels)), stored: [p.width, p.height] };
  } catch (error) {
    return failure(error);
  }
}

async function info(file: Blob) {
  try {
    return { ok: true as const, info: await readRawInfo(file) };
  } catch (error) {
    return failure(error);
  }
}

const api = { decode, libRaw, preview, info };
export type RawTestApi = typeof api;
Comlink.expose(api);
