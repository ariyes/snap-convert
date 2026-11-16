import { describe, expect, it } from 'vitest';
import { createEtaSmoother, ETA_MIN_FRACTION, rawEtaSeconds, runFraction } from './eta';

describe('rawEtaSeconds', () => {
  it('is elapsed × (1 − f) / f', () => {
    expect(rawEtaSeconds(10, 0.5)).toBeCloseTo(10);
    expect(rawEtaSeconds(10, 0.25)).toBeCloseTo(30);
    expect(rawEtaSeconds(30, 0.75)).toBeCloseTo(10);
  });

  it('is null until 4% is done', () => {
    expect(ETA_MIN_FRACTION).toBe(0.04);
    expect(rawEtaSeconds(5, 0)).toBeNull();
    expect(rawEtaSeconds(5, 0.0399)).toBeNull();
    expect(rawEtaSeconds(4, 0.04)).toBeCloseTo(96);
  });

  it('is 0 when everything is done, never negative', () => {
    expect(rawEtaSeconds(12, 1)).toBe(0);
    expect(rawEtaSeconds(12, 1.2)).toBe(0);
  });

  it('is null for nonsense input', () => {
    expect(rawEtaSeconds(Number.NaN, 0.5)).toBeNull();
    expect(rawEtaSeconds(3, Number.NaN)).toBeNull();
  });
});

describe('runFraction', () => {
  it('averages job progress over the jobs in the run', () => {
    expect(runFraction([])).toBe(0);
    expect(runFraction([1, 1, 0.5, 0])).toBeCloseTo(0.625);
    expect(runFraction([0.2, 0.4])).toBeCloseTo(0.3);
  });

  it('clamps each value to 0–1', () => {
    expect(runFraction([2, -1])).toBeCloseTo(0.5);
  });
});

describe('createEtaSmoother', () => {
  it('starts from the first raw estimate', () => {
    const s = createEtaSmoother(2);
    expect(s.update(1, 0.02, 1)).toBeNull();
    expect(s.update(2, 0.2, 2)).toBeCloseTo(8);
  });

  it('follows a steady pace without lag', () => {
    // 100 s run, progress linear in time: true remaining = 100 − t.
    const s = createEtaSmoother(2);
    for (let t = 5; t <= 95; t += 0.25) {
      const last = s.update(t, t / 100, t);
      expect(last).not.toBeNull();
      expect(last ?? 0).toBeCloseTo(100 - t, 6);
    }
  });

  it('damps a sudden jump instead of copying it', () => {
    const s = createEtaSmoother(2);
    s.update(10, 0.5, 10); // raw 10
    // One slow file: progress stalls for 0.25 s, raw jumps by a lot.
    const raw = rawEtaSeconds(10.25, 0.45) ?? 0;
    const smoothed = s.update(10.25, 0.45, 10.25) ?? 0;
    const predicted = 10 - 0.25;
    expect(raw - predicted).toBeGreaterThan(2);
    expect(Math.abs(smoothed - predicted)).toBeLessThan((raw - predicted) * 0.2);
    expect(smoothed).toBeGreaterThan(predicted);
  });

  it('settles on a new pace after a few time constants', () => {
    const s = createEtaSmoother(1);
    s.update(10, 0.5, 10);
    // From now on the raw estimate is a constant 30 s (fed every 0.1 s).
    let v = 0;
    for (let t = 10.1; t < 20; t += 0.1) {
      v = s.update(t, t / (t + 30), t) ?? 0;
    }
    expect(v).toBeGreaterThan(30 * 0.9);
    expect(v).toBeLessThan(30 * 1.1);
  });

  it('does not depend on how often it is called', () => {
    const fast = createEtaSmoother(2);
    const slow = createEtaSmoother(2);
    fast.update(10, 0.5, 10);
    slow.update(10, 0.5, 10);
    const rawAt = (t: number) => ({ elapsed: t, f: t / (t + 25) });
    let vFast = 0;
    for (let t = 10.05; t <= 12.0001; t += 0.05) {
      const r = rawAt(t);
      vFast = fast.update(r.elapsed, r.f, t) ?? 0;
    }
    let vSlow = 0;
    for (let t = 10.5; t <= 12.0001; t += 0.5) {
      const r = rawAt(t);
      vSlow = slow.update(r.elapsed, r.f, t) ?? 0;
    }
    expect(Math.abs(vFast - vSlow)).toBeLessThan(1);
  });

  it('goes back to null when the fraction drops below 4% (and reset clears it)', () => {
    const s = createEtaSmoother(2);
    expect(s.update(5, 0.5, 5)).toBeCloseTo(5);
    expect(s.update(6, 0.01, 6)).toBeNull();
    expect(s.update(7, 0.5, 7)).toBeCloseTo(7);
    s.reset();
    expect(s.update(8, 0.8, 8)).toBeCloseTo(2);
  });
});
