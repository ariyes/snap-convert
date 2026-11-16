// Quality guard (D28, docs/03-features.md "Quality guard"): default and preset runs must look
// crisp. Heavy-grain photos score low at quality 80 in every encoder, so the quality is raised in
// steps until the visual score reaches the default floor. Never used when the user set the quality.
import { QUALITY_FLOOR } from '@/core/contracts/image';
import type { Attempt, EncodeAt } from './attempt';

export const GUARD = {
  /** Quality is raised by this much per step… */
  step: 4,
  /** …up to this. */
  maxQuality: 92,
  /** Score every default/preset result should reach. */
  targetSsim: QUALITY_FLOOR.defaultSsim,
  /** Score nothing may go below; if 92 still misses it, keep stepping up to 100 (last resort). */
  floorSsim: QUALITY_FLOOR.minSsim,
} as const;

export interface GuardResult {
  /** The result to keep. */
  best: Attempt;
  /** Extra encodes the guard made (0 = the first result was already crisp enough). */
  steps: number;
  /** `best` scores at least {@link GUARD.targetSsim}. */
  reached: boolean;
  /** Every attempt, first one included, in the order made. */
  attempts: Attempt[];
}

/**
 * Starting from `first` (the result at the requested quality), re-encodes at +4 quality steps up
 * to 92 until SSIM ≥ 0.97 and keeps the lowest quality that gets there (smallest file). If none
 * does, keeps the best-scoring result; if even that is below 0.95, keeps stepping (96, 100) until
 * it reaches 0.95. `onStep(i)` is called before each extra encode (1-based).
 */
export async function guardQuality(
  first: Attempt,
  encodeAt: EncodeAt,
  onStep?: (step: number) => void,
): Promise<GuardResult> {
  const attempts = [first];
  let best = first;
  let quality = first.quality;

  const next = async (limit: number, until: number): Promise<void> => {
    while (best.ssim < until && quality < limit) {
      quality = Math.min(limit, quality + GUARD.step);
      onStep?.(attempts.length);
      const a = await encodeAt(quality);
      attempts.push(a);
      if (a.ssim > best.ssim) best = a;
    }
  };

  await next(GUARD.maxQuality, GUARD.targetSsim);
  if (best.ssim < GUARD.floorSsim) await next(100, GUARD.floorSsim);

  return {
    best,
    steps: attempts.length - 1,
    reached: best.ssim >= GUARD.targetSsim,
    attempts,
  };
}
