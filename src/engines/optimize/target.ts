// IMG-05 "Make it under X KB": the highest quality whose file fits, never below the quality floor
// (D24: quality 60, SSIM 0.95). If the target can't be met without ruining the image, the search
// stops at the floor and says how small the image would need to be instead.
import { QUALITY_FLOOR } from '@/core/contracts/image';
import type { Size } from '@/core/contracts/sizing';
import { fitSize } from '@/core/sizing';
import type { Attempt, EncodeAt } from './attempt';

export const TARGET_SEARCH = {
  /** Most encodes one search may make (the first at the ceiling included). */
  maxEncodes: 7,
} as const;

export interface TargetOptions {
  targetBytes: number;
  /** Highest quality to try: the quality the user asked for. */
  maxQuality: number;
  /** Never go below this quality (default 60). */
  minQuality?: number;
  /** Never accept a result scoring below this (default 0.95). */
  minSsim?: number;
  /** Encode budget (default 7). */
  maxEncodes?: number;
  /** Size of the pixels being encoded, for the resize suggestion when the target can't be met. */
  size?: Size;
  /** Called before each encode with how many have been made so far. */
  onEncode?: (done: number, budget: number) => void;
}

export interface TargetResult {
  /** The result to keep: the highest quality that fits, or the floor result if nothing does. */
  best: Attempt;
  /** `best` is within the target and scores at least the SSIM floor. */
  reached: boolean;
  encodes: number;
  attempts: Attempt[];
  /** When not reached: an estimate of the size (by the sizing rule) at which the target would fit. */
  suggestedSize?: Size;
}

/**
 * Binary search on quality for the highest quality whose file is ≤ `targetBytes`, reusing the
 * same resized pixels through `encodeAt`. At most 7 encodes; never below quality 60 and never a
 * result below SSIM 0.95. Size and score both rise with quality, so:
 *
 * - The ceiling (`maxQuality`) is tried first. If it fits and scores ≥ 0.95, it is the answer.
 * - If it scores below 0.95 (heavy grain), every lower quality would too: instead find the lowest
 *   quality above it that reaches 0.95 (up to 100). If that fits, it is the answer.
 * - Otherwise look for the highest quality below the ceiling that fits, accepted only if it
 *   scores ≥ 0.95.
 * - If nothing works, the target is unreachable: the result is the floor — the lowest quality tried
 *   that still scores ≥ 0.95 — plus a suggested smaller size.
 */
export async function findQualityForTarget(
  encodeAt: EncodeAt,
  o: TargetOptions,
): Promise<TargetResult> {
  const minQuality = o.minQuality ?? QUALITY_FLOOR.minQuality;
  const minSsim = o.minSsim ?? QUALITY_FLOOR.minSsim;
  const budget = Math.max(1, o.maxEncodes ?? TARGET_SEARCH.maxEncodes);
  const ceiling = Math.max(minQuality, Math.round(o.maxQuality));
  const attempts: Attempt[] = [];
  const cache = new Map<number, Attempt>();

  const probe = async (quality: number): Promise<Attempt> => {
    const known = cache.get(quality);
    if (known) return known;
    o.onEncode?.(attempts.length, budget);
    const a = await encodeAt(quality);
    cache.set(quality, a);
    attempts.push(a);
    return a;
  };
  const fits = (a: Attempt) => a.bytes <= o.targetBytes;
  const acceptable = (a: Attempt) => a.ssim >= minSsim;
  const done = (best: Attempt, reached: boolean): TargetResult => {
    const result: TargetResult = { best, reached, encodes: attempts.length, attempts };
    if (!reached && o.size && best.bytes > o.targetBytes) {
      result.suggestedSize = sizeForTarget(o.size, best.bytes, o.targetBytes);
    }
    return result;
  };

  const floorResult = (): Attempt =>
    [...attempts].sort((a, b) => a.quality - b.quality).find(acceptable) ??
    attempts.reduce((best, a) => (a.ssim > best.ssim ? a : best));

  const first = await probe(ceiling);
  if (!acceptable(first)) {
    // Lowest quality in (ceiling, 100] that scores ≥ minSsim.
    let low = ceiling + 1;
    let high = 100;
    let lowest: Attempt | undefined;
    while (low <= high && attempts.length < budget) {
      const mid = Math.floor((low + high) / 2);
      const a = await probe(mid);
      if (acceptable(a)) {
        lowest = a;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    if (lowest && fits(lowest)) return done(lowest, true);
    return done(floorResult(), false);
  }
  if (fits(first)) return done(first, true);

  // Highest fitting quality in [minQuality, ceiling - 1].
  let low = minQuality;
  let high = ceiling - 1;
  let found: Attempt | undefined;
  while (low <= high && attempts.length < budget) {
    const mid = Math.floor((low + high + 1) / 2);
    const a = await probe(mid);
    if (fits(a)) {
      found = a;
      low = mid + 1;
    } else {
      // Too big *and* already below the visual floor: higher qualities are bigger still and lower
      // ones look worse, so no quality can work. Stop early.
      if (!acceptable(a)) break;
      high = mid - 1;
    }
  }
  if (found && acceptable(found)) return done(found, true);

  // Unreachable: the floor result is the lowest quality tried that still looks acceptable.
  return done(floorResult(), false);
}

/**
 * Bytes per pixel go up as an image gets smaller (detail gets denser), so file size falls
 * slower than pixel count. Measured on the reference set at the quality floor (JPEG, sharpened
 * Lanczos downscale): bytes ∝ pixels^0.65–0.7. Solve for the scale with 0.65 (the cautious end),
 * keep a 5% margin, and let the sizing rule produce the size (never stretched, never enlarged).
 */
const BYTES_PIXEL_EXPONENT = 0.65;
const SUGGESTION_MARGIN = 0.95;

export function sizeForTarget(size: Size, bytes: number, targetBytes: number): Size {
  if (!(bytes > targetBytes) || !(targetBytes > 0))
    return { width: size.width, height: size.height };
  const linear = (targetBytes / bytes) ** (1 / (2 * BYTES_PIXEL_EXPONENT)) * SUGGESTION_MARGIN;
  const { width, height } = fitSize(size, { mode: 'percent', value: linear * 100 });
  return { width, height };
}
