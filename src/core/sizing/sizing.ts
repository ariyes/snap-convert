// M3 — the one sizing rule (docs/03-features.md#the-sizing-rule-applies-everywhere).
// Every output size in Snap Convert comes from here. Nothing is ever stretched.
//
// Exact rounding: a scale is kept as a ratio `num / den` and every length is computed as
// `round(len × num / den)` — the product is exact for whole-pixel inputs and the division is
// correctly rounded, so `Math.round` (half rounds up) sees the true value, ties included.

import type {
  Anchor,
  ExactPlacement,
  FitMode,
  FitSize,
  Placement,
  Rect,
  ResizeMode,
  Size,
} from '@/core/contracts/sizing';

/** A scale factor kept as a fraction to avoid compounding floating-point error. */
interface Ratio {
  num: number;
  den: number;
}

const ONE: Ratio = { num: 1, den: 1 };

const RESIZE_MODES: readonly ResizeMode[] = ['none', 'longest', 'width', 'height', 'percent'];
const FIT_MODES: readonly FitMode[] = ['fit', 'fill'];

/** Where an anchor puts the image on each axis: 0 = start, 0.5 = middle, 1 = end. */
const ANCHORS: Readonly<Record<Anchor, readonly [x: number, y: number]>> = {
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  'bottom-left': [0, 1],
  bottom: [0.5, 1],
  'bottom-right': [1, 1],
};
const ANCHOR_NAMES = Object.keys(ANCHORS) as Anchor[];

// ---------- validation ----------

function describeValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Throws a RangeError unless `value` is a finite number greater than 0. */
function requirePositive(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${what} must be a finite number greater than 0 (got ${describeValue(value)}).`,
    );
  }
  return value;
}

function requireSource(src: Size): void {
  requirePositive(src.width, 'Source width');
  requirePositive(src.height, 'Source height');
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

// ---------- exact ratio maths ----------

function isGreater(a: Ratio, b: Ratio): boolean {
  return a.num * b.den > b.num * a.den;
}

function minRatio(a: Ratio, b: Ratio): Ratio {
  return isGreater(a, b) ? b : a;
}

function maxRatio(a: Ratio, b: Ratio): Ratio {
  return isGreater(a, b) ? a : b;
}

/** Never enlarge unless the user asked for it. */
function capAtOne(scale: Ratio, upscale: boolean | undefined): Ratio {
  return upscale !== true && isGreater(scale, ONE) ? ONE : scale;
}

/** `len × scale`, as exactly as floating point allows. */
function scaled(len: number, scale: Ratio): number {
  return (len * scale.num) / scale.den;
}

/** `len × scale` rounded to whole pixels, never below 1. */
function scaledPixels(len: number, scale: Ratio): number {
  return Math.max(1, Math.round(scaled(len, scale)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Offset of a span inside a larger span for an anchor position (0, 0.5 or 1). */
function offset(free: number, position: number): number {
  return Math.floor(free * position);
}

// ---------- fitSize ----------

/** Turns a pixel limit into whole pixels. Rounded down so the output never exceeds it; at least 1. */
function limitPixels(value: unknown): number {
  return Math.max(1, Math.floor(requirePositive(value, 'Size limit')));
}

function resizeScale(src: Size, mode: ResizeMode, value: unknown): Ratio {
  switch (mode) {
    case 'none':
      return ONE;
    case 'percent':
      return { num: requirePositive(value, 'Percentage'), den: 100 };
    case 'width':
      return { num: limitPixels(value), den: src.width };
    case 'height':
      return { num: limitPixels(value), den: src.height };
    case 'longest':
      return { num: limitPixels(value), den: Math.max(src.width, src.height) };
  }
}

/**
 * The one sizing rule. Never stretches: both sides use the same scale.
 *
 * - `longest` limits both sides to `value` px, `width` / `height` limit one side, `percent` scales by
 *   `value / 100`, `none` keeps the size. Pixel limits are whole pixels (a fractional limit is
 *   rounded down, so the output never exceeds it).
 * - Never enlarges unless `upscale` is true.
 * - Each side is `round(side × scale)` and at least 1 px.
 * - Source sizes may be fractional (e.g. PDF points); output sizes are always whole.
 *
 * @throws RangeError for a size, limit or percentage that is 0, negative, NaN or infinite, or an
 *   unknown mode.
 */
export const fitSize: FitSize = (src, o) => {
  requireSource(src);
  if (!isOneOf(o.mode, RESIZE_MODES)) {
    throw new RangeError(
      `Resize mode must be one of ${RESIZE_MODES.join(', ')} (got ${describeValue(o.mode)}).`,
    );
  }
  const scale = capAtOne(resizeScale(src, o.mode, o.value), o.upscale);
  const width = scaledPixels(src.width, scale);
  const height = scaledPixels(src.height, scale);
  const factor = scale.num / scale.den;
  return {
    width,
    height,
    scale: factor,
    enlarged: factor > 1,
    unchanged: width === src.width && height === src.height,
  };
};

// ---------- exactPlacement ----------

/** The part of the source used on one axis, and where it lands on the canvas. */
interface AxisPlacement {
  sourceStart: number;
  sourceLength: number;
  targetStart: number;
  targetLength: number;
}

/** Turns a box side into whole canvas pixels (nearest whole pixel, at least 1). */
function boxPixels(value: unknown, what: string): number {
  return Math.max(1, Math.round(requirePositive(value, what)));
}

/**
 * Places one axis of the source on the canvas at `scale`.
 * If the scaled source fits, all of it is drawn (padding the rest). If it overflows, a whole-pixel
 * slice is cut around the anchor so that `sourceLength × scale` matches `targetLength` within 1 px.
 */
function placeAxis(
  sourceLen: number,
  canvasLen: number,
  scale: Ratio,
  position: number,
): AxisPlacement {
  let sourceLength: number;
  let targetLength: number;

  if (sourceLen * scale.num <= canvasLen * scale.den) {
    // The whole axis fits: draw all of it.
    sourceLength = sourceLen;
    targetLength = Math.min(canvasLen, scaledPixels(sourceLen, scale));
  } else {
    // Overflow: crop. Ideal slice = canvasLen / scale, rounded to whole source pixels.
    sourceLength = clamp(Math.round((canvasLen * scale.den) / scale.num), 1, sourceLen);
    const drawn = scaled(sourceLength, scale);
    if (Math.abs(drawn - canvasLen) <= 1 || (sourceLength === 1 && drawn > canvasLen)) {
      // Covers the canvas within 1 px of rounding. (Or a single source pixel is bigger than the
      // canvas: drawing it to the canvas is a sub-pixel crop of one flat colour, not a stretch.)
      targetLength = canvasLen;
    } else if (drawn > canvasLen) {
      // Only when enlarging more than 2×: one source pixel less, so the slice fits without stretching.
      sourceLength -= 1;
      targetLength = scaledPixels(sourceLength, scale);
    } else {
      // Only when enlarging more than 2×: the nearest slice is a little short; pad the gap.
      targetLength = scaledPixels(sourceLength, scale);
    }
  }

  return {
    sourceStart: offset(sourceLen - sourceLength, position),
    sourceLength,
    targetStart: offset(canvasLen - targetLength, position),
    targetLength,
  };
}

/**
 * Exact output box. Never stretches.
 *
 * - **fit**: the whole image, scaled to fit inside the box (never enlarged unless `upscale`), placed
 *   at `anchor` (default centre). `padded` when it doesn't cover the box.
 * - **fill**: scaled to cover the box and the overflow cropped around `anchor`. Without `upscale`
 *   the image is never enlarged: a side shorter than the box is kept whole and padded instead.
 *
 * The box is in whole pixels (a fractional box is rounded to the nearest pixel). For whole-pixel
 * sources every rectangle is whole pixels; `target` always lies inside `canvas`; `source` scaled to
 * `target` keeps its aspect ratio within 1 px of rounding.
 *
 * @throws RangeError for a size that is 0, negative, NaN or infinite, or an unknown fit or anchor.
 */
export const exactPlacement: ExactPlacement = (src, o) => {
  requireSource(src);
  const canvas: Size = {
    width: boxPixels(o.width, 'Box width'),
    height: boxPixels(o.height, 'Box height'),
  };
  if (!isOneOf(o.fit, FIT_MODES)) {
    throw new RangeError(
      `Fit must be one of ${FIT_MODES.join(', ')} (got ${describeValue(o.fit)}).`,
    );
  }
  const anchor = o.anchor ?? 'center';
  if (!isOneOf(anchor, ANCHOR_NAMES)) {
    throw new RangeError(
      `Anchor must be one of ${ANCHOR_NAMES.join(', ')} (got ${describeValue(anchor)}).`,
    );
  }
  const [ax, ay] = ANCHORS[anchor];

  const byWidth: Ratio = { num: canvas.width, den: src.width };
  const byHeight: Ratio = { num: canvas.height, den: src.height };
  const ideal = o.fit === 'fit' ? minRatio(byWidth, byHeight) : maxRatio(byWidth, byHeight);
  const scale = capAtOne(ideal, o.upscale);

  const x = placeAxis(src.width, canvas.width, scale, ax);
  const y = placeAxis(src.height, canvas.height, scale, ay);

  const source: Rect = {
    x: x.sourceStart,
    y: y.sourceStart,
    width: x.sourceLength,
    height: y.sourceLength,
  };
  const target: Rect = {
    x: x.targetStart,
    y: y.targetStart,
    width: x.targetLength,
    height: y.targetLength,
  };
  return {
    canvas,
    source,
    target,
    padded: target.width < canvas.width || target.height < canvas.height,
    cropped: source.width < src.width || source.height < src.height,
    enlarged: isGreater(scale, ONE),
  };
};

// ---------- helpers ----------

/** Width divided by height. @throws RangeError for an invalid size. */
export function aspectRatio(size: Size): number {
  requireSource(size);
  return size.width / size.height;
}

function formatSize(size: Size): string {
  return `${size.width}×${size.height}`;
}

/**
 * Short text for the UI, e.g. "4032×3024 → 1920×1440".
 * `result` is a `fitSize` result or an `exactPlacement` (its canvas is the output size).
 */
export function describe(src: Size, result: Size | Placement): string {
  const out = 'canvas' in result ? result.canvas : result;
  return `${formatSize(src)} → ${formatSize(out)}`;
}
