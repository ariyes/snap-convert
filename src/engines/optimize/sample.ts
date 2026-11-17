// Quality guard on very large images (P24b, F2). One full-size encode of a 48 MP photo takes 6–12
// seconds, and a grainy photo can need four before it scores 0.97. So above GUARD_SAMPLE.abovePixels
// the guard first runs on a small sample to find the quality it would stop at, then the full image
// is encoded once at that quality and checked at full size.
//
// The sample is a mosaic of tiles cut from the full-resolution pixels, spread evenly over the
// image — never a downscaled copy: downscaling blurs away the grain and block artefacts the score
// is there to catch, so a downscaled copy would let the guard stop at a lower quality. Tiles start
// on multiples of 16 pixels, so every 8×8 JPEG block (16×16 with 4:2:0) and every 16×16 WebP
// macroblock in the mosaic holds exactly the pixels of a block of the full image.
import type { ImageFormat } from '@/core/contracts/image';
import type { Size } from '@/core/contracts/sizing';
import type { Attempt, EncodeAt } from './attempt';
import { guardQuality, type GuardPlan, type GuardResult } from './guard';

export const GUARD_SAMPLE = {
  /** The sample has at most this many pixels (encodes in about a twentieth of the time at 48 MP). */
  maxPixels: 2_000_000,
  /** Images above this many pixels (4× the sample) are guarded on a sample first. */
  abovePixels: 8_000_000,
  /** Tile side in pixels: a multiple of 16 (JPEG MCU, WebP macroblock). */
  tile: 128,
  /** Block grid the tiles are aligned to. */
  align: 16,
  /** Most extra full-size encodes after the predicted one (like D31 for AVIF). */
  maxFullSteps: 2,
} as const;

export type GuardSampleMode = 'auto' | 'always' | 'never';

/**
 * Whether the guard runs on a sample first. AVIF doesn't: libaom's speed depends on the pixel
 * count, so a small sample encodes differently from the full image (and D31 already caps AVIF at
 * two extra encodes). PNG is lossless and has no guard. `always` (tests) samples anything bigger
 * than the sample itself.
 */
export function usesGuardSample(
  format: ImageFormat,
  size: Size,
  mode: GuardSampleMode = 'auto',
): boolean {
  if (mode === 'never' || (format !== 'jpeg' && format !== 'webp')) return false;
  const pixels = size.width * size.height;
  const above = mode === 'always' ? GUARD_SAMPLE.maxPixels : GUARD_SAMPLE.abovePixels;
  return pixels > above && Math.min(size.width, size.height) >= GUARD_SAMPLE.tile;
}

export interface TileGrid {
  /** Tiles across and down. */
  cols: number;
  rows: number;
  /** Left edges (cols) and top edges (rows) of the tiles in the full image. */
  xs: number[];
  ys: number[];
  tile: number;
}

/**
 * Where the sample's tiles come from: an even grid over the whole image (as many tiles as fit in
 * the sample budget, the grid's shape following the image's), each tile starting on the block
 * grid. Deterministic: the same size always gives the same tiles.
 */
export function sampleGrid(size: Size, maxPixels: number = GUARD_SAMPLE.maxPixels): TileGrid {
  const { tile, align } = GUARD_SAMPLE;
  const maxTiles = Math.max(1, Math.floor(maxPixels / (tile * tile)));
  const across = Math.max(1, Math.floor(size.width / tile));
  const down = Math.max(1, Math.floor(size.height / tile));
  // cols / rows ≈ width / height, cols · rows ≤ maxTiles, never more tiles than fit side by side.
  let cols = Math.min(
    across,
    Math.max(1, Math.round(Math.sqrt((maxTiles * size.width) / size.height))),
  );
  const rows = Math.min(down, Math.max(1, Math.floor(maxTiles / cols)));
  cols = Math.min(across, Math.max(1, Math.floor(maxTiles / rows)));
  // Centred in equal strips; snapping to the block grid can make neighbours overlap by < 16 px.
  const place = (count: number, length: number) =>
    Array.from({ length: count }, (_, i) => {
      const centre = ((i + 0.5) * length) / count;
      const start = Math.min(centre - tile / 2, length - tile);
      return Math.max(0, Math.floor(start / align) * align);
    });
  return { cols, rows, xs: place(cols, size.width), ys: place(rows, size.height), tile };
}

export interface RgbaPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Copies the grid's tiles out of `img` into one mosaic image (tiles side by side, in grid order). */
export function cutSample(img: RgbaPixels, grid: TileGrid): RgbaPixels {
  const { cols, rows, xs, ys, tile } = grid;
  const width = cols * tile;
  const out = new Uint8ClampedArray(width * rows * tile * 4);
  const rowBytes = tile * 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let y = 0; y < tile; y++) {
        const from = ((ys[r]! + y) * img.width + xs[c]!) * 4;
        const to = ((r * tile + y) * width + c * tile) * 4;
        out.set(img.data.subarray(from, from + rowBytes), to);
      }
    }
  }
  return { width, height: rows * tile, data: out };
}

export interface GuardPrediction {
  /** The quality the guard would stop at, judged on the sample. */
  quality: number;
  /** Guard steps the sample run took (as {@link GuardResult.steps}). */
  steps: number;
  /** The sample reached 0.97 at `quality`. */
  reached: boolean;
  /** Encodes made on the sample. */
  encodes: number;
}

/**
 * Runs the guard on the sample (`first` = the sample at the requested quality, `encodeAt` encodes
 * and scores the sample) and returns where it stopped: the lowest step that reached 0.97, or —
 * when none did — the best-scoring one, exactly as {@link guardQuality} picks at full size.
 */
export async function predictGuardQuality(
  first: Attempt,
  encodeAt: EncodeAt,
  plan?: GuardPlan,
): Promise<GuardPrediction> {
  const g = await guardQuality(first, encodeAt, undefined, plan);
  return {
    quality: g.best.quality,
    steps: g.steps,
    reached: g.reached,
    encodes: g.attempts.length,
  };
}

/**
 * The full-size half of a sampled guard. `first` is the full image encoded at the predicted
 * quality. If it scores 0.97, that's the answer. If the sample reached 0.97 but the full image
 * doesn't, the guard carries on up its usual steps at full size; if the sample never reached 0.97,
 * neither would more full-size steps up to 92, so only the 0.95 floor may still raise it. Either
 * way at most {@link GUARD_SAMPLE.maxFullSteps} more full-size encodes. Steps are counted from the
 * requested quality, as an unsampled guard counts them.
 */
export async function guardFromPrediction(
  first: Attempt,
  encodeAt: EncodeAt,
  predicted: GuardPrediction,
  plan: GuardPlan,
  onStep?: (step: number) => void,
): Promise<GuardResult> {
  const full = await guardQuality(first, encodeAt, onStep, {
    step: plan.step,
    maxSteps: Math.min(plan.maxSteps, GUARD_SAMPLE.maxFullSteps),
    targetLimit: predicted.reached ? undefined : first.quality,
  });
  return { ...full, steps: predicted.steps + full.steps };
}
