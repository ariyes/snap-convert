// Property tests for the sizing rule: thousands of seeded random cases, including extreme aspect
// ratios. Expected sizes come from an exact BigInt oracle, independent of floating point.

import { describe as group, expect, it } from 'vitest';
import type { Anchor, Placement, Rect, ResizeMode, Size } from '@/core/contracts/sizing';
import { exactPlacement, fitSize } from './index';

const CASES = 5000;

/** mulberry32 — small, fast, seeded PRNG so failures are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generator(seed: number) {
  const next = prng(seed);
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  /** Log-uniform whole number in [1, max]: as many tiny sides as huge ones, so extreme ratios are common. */
  const side = (max: number): number =>
    Math.min(max, Math.max(1, Math.round(Math.exp(next() * Math.log(max)))));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  return { next, int, side, pick };
}

/** Exact round-half-up of a × num / den for whole numbers. */
function exactRound(a: number, num: number, den: number): number {
  const n = BigInt(a) * BigInt(num);
  const d = BigInt(den);
  return Number((2n * n + d) / (2n * d));
}

const greater = (n1: number, d1: number, n2: number, d2: number): boolean =>
  BigInt(n1) * BigInt(d2) > BigInt(n2) * BigInt(d1);

const isWhole = (n: number): boolean => Number.isInteger(n);
const rectIsWhole = (r: Rect): boolean => [r.x, r.y, r.width, r.height].every(isWhole);

const ANCHORS: readonly Anchor[] = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];
const MODES: readonly ResizeMode[] = ['none', 'longest', 'width', 'height', 'percent'];

/** Where an anchor sits on each axis: 0 start, 0.5 middle, 1 end. */
function anchorPosition(anchor: Anchor): [number, number] {
  const x = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? 1 : 0.5;
  const y = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 1 : 0.5;
  return [x, y];
}

function checkOffset(start: number, length: number, total: number, position: number): void {
  const before = start;
  const after = total - start - length;
  expect(before).toBeGreaterThanOrEqual(0);
  expect(after).toBeGreaterThanOrEqual(0);
  if (position === 0) expect(before).toBe(0);
  else if (position === 1) expect(after).toBe(0);
  else expect(Math.abs(before - after)).toBeLessThanOrEqual(1);
}

group('fitSize — property', () => {
  it(`${CASES} random cases: same aspect ratio within 1 px, limits respected, exact rounding`, () => {
    const g = generator(0x5eed_0003);
    for (let i = 0; i < CASES; i++) {
      const w = g.side(30000);
      const h = g.side(30000);
      const mode = g.pick(MODES);
      const value = mode === 'percent' ? g.int(1, 400) : g.side(30000);
      const upscale = g.next() < 0.3;
      const label = `case ${i}: ${w}×${h} ${mode} ${value}${upscale ? ' upscale' : ''}`;

      const r = fitSize({ width: w, height: h }, { mode, value, upscale });

      // Oracle: the scale as an exact fraction.
      let [num, den] = (
        {
          none: [1, 1],
          percent: [value, 100],
          width: [value, w],
          height: [value, h],
          longest: [value, Math.max(w, h)],
        } as const satisfies Record<ResizeMode, readonly [number, number]>
      )[mode];
      if (!upscale && greater(num, den, 1, 1)) [num, den] = [1, 1];

      expect({ width: r.width, height: r.height }, label).toEqual({
        width: Math.max(1, exactRound(w, num, den)),
        height: Math.max(1, exactRound(h, num, den)),
      });
      expect(r.scale, label).toBeCloseTo(num / den, 12);

      // Whole pixels, never 0.
      expect(isWhole(r.width) && isWhole(r.height), label).toBe(true);
      expect(Math.min(r.width, r.height), label).toBeGreaterThanOrEqual(1);

      // Same aspect ratio: both sides are the source sides times one scale, within rounding
      // (≤ 0.5 px, or < 1 px when a side was raised to the 1 px minimum).
      for (const [out, src] of [
        [r.width, w],
        [r.height, h],
      ] as const) {
        const ideal = src * r.scale;
        const error = Math.abs(out - ideal);
        expect(error, label).toBeLessThanOrEqual(ideal < 0.5 ? 1 : 0.5 + 1e-9);
      }

      // Limits are never exceeded, and the limiting side reaches the limit when shrinking.
      if (mode === 'longest' || mode === 'width' || mode === 'height') {
        const limited =
          mode === 'width' ? r.width : mode === 'height' ? r.height : Math.max(r.width, r.height);
        const srcSide = mode === 'width' ? w : mode === 'height' ? h : Math.max(w, h);
        expect(limited, label).toBeLessThanOrEqual(value);
        expect(limited, label).toBe(upscale ? value : Math.min(value, srcSide));
      }

      // Never enlarge unless asked.
      if (!upscale) {
        expect(r.width <= w && r.height <= h, label).toBe(true);
        expect(r.enlarged, label).toBe(false);
      }
      expect(r.enlarged, label).toBe(r.scale > 1);
      expect(r.unchanged, label).toBe(r.width === w && r.height === h);
    }
  });

  it('fractional percentages keep the aspect ratio too', () => {
    const g = generator(0x5eed_0004);
    for (let i = 0; i < 1000; i++) {
      const w = g.side(20000);
      const h = g.side(20000);
      const value = 0.1 + g.next() * 300;
      const r = fitSize({ width: w, height: h }, { mode: 'percent', value, upscale: true });
      expect(r.scale).toBeCloseTo(value / 100, 12);
      expect(Math.abs(r.width - w * r.scale)).toBeLessThanOrEqual(
        w * r.scale < 0.5 ? 1 : 0.5 + 1e-9,
      );
      expect(Math.abs(r.height - h * r.scale)).toBeLessThanOrEqual(
        h * r.scale < 0.5 ? 1 : 0.5 + 1e-9,
      );
    }
  });
});

/** Common checks for every placement. Returns nothing; fails the test on a broken rule. */
function checkPlacement(p: Placement, src: Size, box: Size, anchor: Anchor, label: string): void {
  const { canvas, source, target } = p;
  expect(canvas, label).toEqual(box);
  expect(rectIsWhole(source) && rectIsWhole(target), label).toBe(true);
  expect(
    Math.min(source.width, source.height, target.width, target.height),
    label,
  ).toBeGreaterThanOrEqual(1);

  // Source inside the image; target inside the canvas.
  expect(source.x >= 0 && source.y >= 0, label).toBe(true);
  expect(
    source.x + source.width <= src.width && source.y + source.height <= src.height,
    label,
  ).toBe(true);
  expect(target.x >= 0 && target.y >= 0, label).toBe(true);
  expect(
    target.x + target.width <= canvas.width && target.y + target.height <= canvas.height,
    label,
  ).toBe(true);

  // Flags match the rectangles.
  expect(p.padded, label).toBe(target.width < canvas.width || target.height < canvas.height);
  expect(p.cropped, label).toBe(source.width < src.width || source.height < src.height);

  // Anchor: offsets in the canvas (and in the source when cropped).
  const [ax, ay] = anchorPosition(anchor);
  checkOffset(target.x, target.width, canvas.width, ax);
  checkOffset(target.y, target.height, canvas.height, ay);
  checkOffset(source.x, source.width, src.width, ax);
  checkOffset(source.y, source.height, src.height, ay);
}

group('exactPlacement — property', () => {
  it(`fit, ${CASES} random cases: whole image, same aspect ratio within 1 px, inside the box`, () => {
    const g = generator(0x5eed_0005);
    for (let i = 0; i < CASES; i++) {
      const src = { width: g.side(30000), height: g.side(30000) };
      const box = { width: g.side(8000), height: g.side(8000) };
      const anchor = g.pick(ANCHORS);
      const upscale = g.next() < 0.3;
      const label = `case ${i}: ${src.width}×${src.height} fit ${box.width}×${box.height} ${anchor}${upscale ? ' upscale' : ''}`;

      const p = exactPlacement(src, { ...box, fit: 'fit', anchor, upscale });
      checkPlacement(p, src, box, anchor, label);

      // Whole image, never cropped.
      expect(p.source, label).toEqual({ x: 0, y: 0, ...src });
      expect(p.cropped, label).toBe(false);

      // Oracle: scale = min(box / src), capped at 1 unless upscale.
      let [num, den] = greater(box.width, src.width, box.height, src.height)
        ? [box.height, src.height]
        : [box.width, src.width];
      if (!upscale && greater(num, den, 1, 1)) [num, den] = [1, 1];
      expect(p.target.width, label).toBe(Math.max(1, exactRound(src.width, num, den)));
      expect(p.target.height, label).toBe(Math.max(1, exactRound(src.height, num, den)));
      expect(p.enlarged, label).toBe(greater(num, den, 1, 1));

      // Same aspect ratio within 1 px.
      const k = num / den;
      expect(Math.abs(p.target.width - src.width * k), label).toBeLessThanOrEqual(1);
      expect(Math.abs(p.target.height - src.height * k), label).toBeLessThanOrEqual(1);

      // Touches the box on at least one side unless capped at the original size.
      if (num !== den || upscale) {
        expect(p.target.width === box.width || p.target.height === box.height, label).toBe(true);
      }
      if (!upscale)
        expect(p.target.width <= src.width && p.target.height <= src.height, label).toBe(true);
    }
  });

  it(`fill, ${CASES} random cases: source and target keep one aspect ratio within 1 px, covers the box`, () => {
    const g = generator(0x5eed_0006);
    for (let i = 0; i < CASES; i++) {
      // Mix of big photos and tiny images (to exercise upscaling well past 2×).
      const src =
        g.next() < 0.2
          ? { width: g.int(1, 12), height: g.int(1, 12) }
          : { width: g.side(30000), height: g.side(30000) };
      const box = { width: g.side(8000), height: g.side(8000) };
      const anchor = g.pick(ANCHORS);
      const upscale = g.next() < 0.4;
      const label = `case ${i}: ${src.width}×${src.height} fill ${box.width}×${box.height} ${anchor}${upscale ? ' upscale' : ''}`;

      const p = exactPlacement(src, { ...box, fit: 'fill', anchor, upscale });
      checkPlacement(p, src, box, anchor, label);

      // Applied scale: cover the box, capped at 1 unless upscale.
      const cover = Math.max(box.width / src.width, box.height / src.height);
      const k = upscale ? cover : Math.min(cover, 1);
      expect(p.enlarged, label).toBe(k > 1);

      // Never stretched: drawing source at scale k lands on target within 1 px on both axes.
      // The one exception is a single source pixel bigger than the box (a sub-pixel crop).
      for (const [s, t, canvasLen] of [
        [p.source.width, p.target.width, box.width],
        [p.source.height, p.target.height, box.height],
      ] as const) {
        const subPixel = s === 1 && k > canvasLen && t === canvasLen;
        if (!subPixel) expect(Math.abs(t - s * k), label).toBeLessThanOrEqual(1 + 1e-9);
      }

      if (!upscale) {
        // Never enlarged: each target side is at most its source side.
        expect(p.target.width <= p.source.width && p.target.height <= p.source.height, label).toBe(
          true,
        );
      }
      if (upscale || cover <= 1) {
        // Covers the box (gaps only possible when enlarging more than 2×).
        if (k <= 2) expect(p.target, label).toEqual({ x: 0, y: 0, ...box });
        expect(p.padded, label).toBe(p.target.width < box.width || p.target.height < box.height);
      } else {
        // Image smaller than the box on some side and no upscale: that side is padded, whole.
        expect(p.padded, label).toBe(src.width < box.width || src.height < box.height);
      }
      // Cropping only cuts what overflows: an axis that fits is never cropped.
      if (src.width * k <= box.width + 1e-9) expect(p.source.width, label).toBe(src.width);
      if (src.height * k <= box.height + 1e-9) expect(p.source.height, label).toBe(src.height);
    }
  });
});
