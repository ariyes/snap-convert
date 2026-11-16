import { describe, expect, it } from 'vitest';
import { SHARPEN_MAX, sharpeningFor } from './index';

describe('sharpeningFor', () => {
  it('is off below 1.25× reduction and for enlargements', () => {
    for (const ratio of [0.5, 1, 1.1, 1.24]) expect(sharpeningFor(ratio).unsharpAmount).toBe(0);
  });

  it('rises gently with the reduction and stops at the maximum', () => {
    const amounts = [1.25, 1.5, 2, 3, 4, 6, 8, 16].map((r) => sharpeningFor(r).unsharpAmount);
    expect(amounts).toEqual([0, 8, 20, 38, 50, 68, 80, 80]);
    for (let i = 1; i < amounts.length; i++) expect(amounts[i]).toBeGreaterThanOrEqual(amounts[i - 1] ?? 0);
  });

  it('uses a small radius and a noise threshold', () => {
    expect(sharpeningFor(4)).toEqual({ unsharpAmount: 50, unsharpRadius: SHARPEN_MAX.radius, unsharpThreshold: SHARPEN_MAX.threshold });
    expect(SHARPEN_MAX.radius).toBeLessThanOrEqual(0.6);
  });

  it('treats NaN as no sharpening', () => {
    expect(sharpeningFor(Number.NaN).unsharpAmount).toBe(0);
  });
});
