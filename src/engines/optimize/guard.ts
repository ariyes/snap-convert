// Quality guard (D28, docs/03-features.md "Quality guard"): default and preset runs must look
// crisp. Heavy-grain photos score low at quality 80 in every encoder, so the quality is raised in
// steps until the visual score reaches the default floor. Never used when the user set the quality.
import type { ImageFormat } from '@/core/contracts/image';
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
  /** D31: each AVIF encode of a big photo takes seconds, so AVIF gets at most 2 extra encodes… */
  avifMaxSteps: 2,
  /** …in bigger steps (at least +6), so the two steps still reach 92 from the default 80. */
  avifMinStep: 6,
} as const;

export interface GuardPlan {
  /** Quality added per extra encode. */
  step: number;
  /** Most extra encodes, last-resort steps included. */
  maxSteps: number;
  /**
   * Highest quality the guard raises to for 0.97 (default 92). The sampled guard on huge images
   * passes the start quality when the sample already showed 0.97 is out of reach, so only the
   * 0.95 floor can raise it further (P24b).
   */
  targetLimit?: number;
}

/**
 * How the guard steps for a format: +4 up to 92 (and beyond only to reach 0.95) for JPEG and WebP;
 * for AVIF at most 2 extra encodes, splitting the way to 92 in two (80 → 86 → 92) (D31).
 */
export function guardPlan(format: ImageFormat, quality: number): GuardPlan {
  if (format !== 'avif') return { step: GUARD.step, maxSteps: Number.POSITIVE_INFINITY };
  const half = Math.ceil((GUARD.maxQuality - quality) / GUARD.avifMaxSteps);
  return { step: Math.max(GUARD.avifMinStep, half), maxSteps: GUARD.avifMaxSteps };
}

/** Extra encodes the guard normally makes at most from `quality` (for progress reporting). */
export function guardMaxSteps(format: ImageFormat, quality: number): number {
  const plan = guardPlan(format, quality);
  const toMax = Math.max(0, Math.ceil((GUARD.maxQuality - quality) / plan.step));
  return Math.min(plan.maxSteps, toMax);
}

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
 * Starting from `first` (the result at the requested quality), re-encodes at higher qualities
 * (`plan.step` at a time, default +4) up to 92 until SSIM ≥ 0.97, and keeps the lowest quality that
 * gets there (smallest file). If none does, keeps the best-scoring result; if even that is below
 * 0.95, keeps stepping toward 100 until it reaches 0.95. Never more than `plan.maxSteps` extra
 * encodes. `onStep(i)` is called before each extra encode (1-based).
 */
export async function guardQuality(
  first: Attempt,
  encodeAt: EncodeAt,
  onStep?: (step: number) => void,
  plan: GuardPlan = { step: GUARD.step, maxSteps: Number.POSITIVE_INFINITY },
): Promise<GuardResult> {
  const attempts = [first];
  let best = first;
  let quality = first.quality;

  const next = async (limit: number, until: number): Promise<void> => {
    while (best.ssim < until && quality < limit && attempts.length - 1 < plan.maxSteps) {
      quality = Math.min(limit, quality + plan.step);
      onStep?.(attempts.length);
      const a = await encodeAt(quality);
      attempts.push(a);
      if (a.ssim > best.ssim) best = a;
    }
  };

  await next(plan.targetLimit ?? GUARD.maxQuality, GUARD.targetSsim);
  if (best.ssim < GUARD.floorSsim) await next(100, GUARD.floorSsim);

  return {
    best,
    steps: attempts.length - 1,
    reached: best.ssim >= GUARD.targetSsim,
    attempts,
  };
}
