// Time-left estimate for a run of jobs (IMG-08).

/** No estimate until this fraction of the run is done. */
export const ETA_MIN_FRACTION = 0.04;
/** Smoothing time constant in seconds: how quickly the estimate follows a change in pace. */
export const ETA_SMOOTHING_SECONDS = 2;

/** `elapsed × (1 − f) / f`, or null while f < 0.04. Seconds in, seconds out. */
export function rawEtaSeconds(elapsedSeconds: number, fraction: number): number | null {
  if (!Number.isFinite(fraction) || !Number.isFinite(elapsedSeconds)) return null;
  if (fraction < ETA_MIN_FRACTION) return null;
  const f = Math.min(fraction, 1);
  return Math.max(0, (elapsedSeconds * (1 - f)) / f);
}

/** Fraction of a run that is done: sum of job progress / jobs in the run (finished jobs count as 1). */
export function runFraction(progresses: readonly number[]): number {
  if (progresses.length === 0) return 0;
  const sum = progresses.reduce((s, p) => s + Math.min(1, Math.max(0, p)), 0);
  return sum / progresses.length;
}

export interface EtaSmoother {
  /** Feed the current run state; returns the smoothed estimate in seconds, or null. */
  update(elapsedSeconds: number, fraction: number, nowSeconds: number): number | null;
  reset(): void;
}

/**
 * Exponential moving average of the raw estimate. Between updates the previous estimate first
 * counts down by the time that passed, so a steady pace is followed without lag, while a sudden
 * jump in the raw value (a slow file, a burst of fast ones) only moves the estimate gradually.
 * The weight of a new sample depends on the time since the last one, not on how often it's called.
 */
export function createEtaSmoother(tauSeconds = ETA_SMOOTHING_SECONDS): EtaSmoother {
  let value: number | null = null;
  let at = 0;
  return {
    update(elapsedSeconds, fraction, nowSeconds) {
      const raw = rawEtaSeconds(elapsedSeconds, fraction);
      if (raw === null) {
        value = null;
        return null;
      }
      if (value === null) {
        value = raw;
      } else {
        const dt = Math.max(0, nowSeconds - at);
        const predicted = Math.max(0, value - dt);
        const alpha = tauSeconds > 0 ? 1 - Math.exp(-dt / tauSeconds) : 1;
        value = predicted + alpha * (raw - predicted);
      }
      at = nowSeconds;
      return value;
    },
    reset() {
      value = null;
      at = 0;
    },
  };
}
