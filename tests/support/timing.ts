// Wall-clock limits in browser tests. Everyday runs (`pnpm test`) use relaxed limits so a busy
// machine (e.g. several agents building at once) can't fail the suite; `pnpm test:perf` sets
// VITE_PERF=1 and enforces the real targets from the task prompts. P24 runs test:perf on a quiet machine.
export const strictTiming = import.meta.env.VITE_PERF === '1';

/** The real target when timing is strict, otherwise a looser sanity bound. */
export function timingLimit(strict: number, relaxed: number): number {
  return strictTiming ? strict : relaxed;
}
