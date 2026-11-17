import { describe, expect, it } from 'vitest';
import type { Attempt } from './attempt';
import { guardMaxSteps, guardPlan, guardQuality } from './guard';

function attempt(quality: number, ssim: number): Attempt {
  return { quality, blob: new Blob([]), bytes: quality * 1000, ssim };
}

function encoder(score: (q: number) => number) {
  const calls: number[] = [];
  return {
    calls,
    encodeAt: (q: number) => {
      calls.push(q);
      return Promise.resolve(attempt(q, score(q)));
    },
  };
}

describe('guardQuality', () => {
  it('keeps a crisp first result without re-encoding', async () => {
    const { encodeAt, calls } = encoder(() => 0.99);
    const r = await guardQuality(attempt(80, 0.98), encodeAt);
    expect(r).toMatchObject({ steps: 0, reached: true });
    expect(r.best.quality).toBe(80);
    expect(calls).toEqual([]);
  });

  it('raises quality in +4 steps and keeps the lowest quality that reaches 0.97', async () => {
    const { encodeAt, calls } = encoder((q) => (q >= 88 ? 0.975 : 0.96));
    const r = await guardQuality(attempt(80, 0.94), encodeAt);
    expect(calls).toEqual([84, 88]);
    expect(r).toMatchObject({ steps: 2, reached: true });
    expect(r.best.quality).toBe(88);
  });

  it('stops at 92 and keeps the best result when 0.97 is out of reach', async () => {
    const { encodeAt, calls } = encoder((q) => 0.9 + q / 2000); // 84 → 0.942 … 92 → 0.946
    const first = attempt(80, 0.955);
    const r = await guardQuality(first, encodeAt);
    expect(calls).toEqual([84, 88, 92]);
    expect(r.reached).toBe(false);
    expect(r.best).toBe(first); // highest score
  });

  it('goes past 92 only to lift a result back above 0.95', async () => {
    const { encodeAt, calls } = encoder((q) => (q >= 96 ? 0.952 : 0.93));
    const r = await guardQuality(attempt(80, 0.92), encodeAt);
    expect(calls).toEqual([84, 88, 92, 96]);
    expect(r.best.quality).toBe(96);
    expect(r.best.ssim).toBeGreaterThanOrEqual(0.95);
  });

  it('AVIF (D31): at most 2 extra encodes, 80 → 86 → 92', async () => {
    expect(guardPlan('avif', 80)).toEqual({ step: 6, maxSteps: 2 });
    expect(guardMaxSteps('avif', 80)).toBe(2);
    expect(guardMaxSteps('jpeg', 80)).toBe(3);
    const { encodeAt, calls } = encoder(() => 0.93);
    const r = await guardQuality(attempt(80, 0.92), encodeAt, undefined, guardPlan('avif', 80));
    expect(calls).toEqual([86, 92]); // no last-resort steps past the cap
    expect(r).toMatchObject({ steps: 2, reached: false });
    const crisp = encoder((q) => (q >= 86 ? 0.975 : 0.96));
    const ok = await guardQuality(
      attempt(80, 0.96),
      crisp.encodeAt,
      undefined,
      guardPlan('avif', 80),
    );
    expect(crisp.calls).toEqual([86]);
    expect(ok.best.quality).toBe(86);
  });

  it('starting above 92 makes no extra encodes unless below 0.95', async () => {
    const { encodeAt, calls } = encoder(() => 0.99);
    const r = await guardQuality(attempt(95, 0.96), encodeAt);
    expect(calls).toEqual([]);
    expect(r.steps).toBe(0);
  });
});
