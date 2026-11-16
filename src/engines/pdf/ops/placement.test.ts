import { describe, expect, it } from 'vitest';
import { fitInBox } from './placement';

const A4 = { width: 595.28, height: 841.89 };
const LETTER = { width: 612, height: 792 };

describe('fitInBox (PDF points)', () => {
  it('fits A4 on Letter: uniform scale, centred, inside the page', () => {
    const { target, scale } = fitInBox(A4, LETTER, true);
    expect(scale).toBeCloseTo(792 / 841.89, 4);
    expect(target.width / A4.width).toBeCloseTo(target.height / A4.height, 4);
    expect(target.height).toBeCloseTo(792, 2);
    expect(target.x).toBeCloseTo((612 - target.width) / 2, 2);
    expect(target.y).toBeCloseTo(0, 2);
    expect(A4.width * scale).toBeLessThanOrEqual(target.width + 1e-9);
    expect(A4.height * scale).toBeLessThanOrEqual(target.height + 1e-9);
  });

  it('keeps fractional points to within 0.01 pt', () => {
    const { target } = fitInBox(
      { width: 600, height: 900 },
      { width: 538.59, height: 785.2 },
      true,
    );
    expect(target.height).toBeCloseTo(785.2, 2);
    expect(target.width).toBeCloseTo((785.2 * 600) / 900, 1);
    expect(target.x).toBeCloseTo((538.59 - target.width) / 2, 2);
  });

  it('enlarges only with upscale', () => {
    expect(
      fitInBox({ width: 100, height: 50 }, { width: 400, height: 400 }, false).target,
    ).toMatchObject({
      width: 100,
      height: 50,
      x: 150,
      y: 175,
    });
    const up = fitInBox({ width: 100, height: 50 }, { width: 400, height: 400 }, true);
    expect(up.target).toMatchObject({ width: 400, height: 200, x: 0, y: 100 });
    expect(up.scale).toBe(4);
  });

  it('measures y from the bottom (PDF coordinates)', () => {
    // A wide image on a tall box sits in the middle either way; y is the gap below it.
    const { target } = fitInBox({ width: 200, height: 100 }, { width: 200, height: 300 }, false);
    expect(target.y).toBe(100);
  });

  it('never stretches: target ratio equals content ratio', () => {
    for (const [w, h] of [
      [1, 10000],
      [9000, 2600],
      [3024, 4032],
      [595.28, 841.89],
      [14400, 3],
    ] as const) {
      const { target } = fitInBox({ width: w, height: h }, A4, true);
      // Same ratio within rounding (0.01 pt): neither side is scaled differently.
      const scale = Math.max(target.width / w, target.height / h);
      expect(Math.abs(target.width - w * scale)).toBeLessThanOrEqual(0.011);
      expect(Math.abs(target.height - h * scale)).toBeLessThanOrEqual(0.011);
      expect(target.x + target.width).toBeLessThanOrEqual(A4.width + 0.01);
      expect(target.y + target.height).toBeLessThanOrEqual(A4.height + 0.01);
    }
  });
});
