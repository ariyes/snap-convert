import type { IsGraphic } from '@/core/contracts/image';
import { assertPixels, type Pixels } from './pixels';

/** Neighbour pairs differing by at most this much (largest channel) count as fine texture. */
const SUBTLE_STEP = 8;
/**
 * A small step is part of a smooth ramp (drop shadow, glow, gradient) when the next step in the
 * same direction is about the same: the second difference stays within this many levels.
 * Photo grain jumps about.
 */
const RAMP_BEND = 2;
/** Sample about this many pixels at most, so a 12 MP image is checked in a few milliseconds. */
const MAX_SAMPLES = 1_000_000;

export interface GraphicStats {
  /** Neighbour pairs looked at (each sampled pixel vs. its right and lower neighbour). */
  pairs: number;
  /** Share of pairs whose colours are exactly equal (flat areas). */
  flat: number;
  /** Share of the non-equal pairs that differ only slightly (photo grain, smooth gradients). */
  subtle: number;
  /**
   * Shares of all pairs, judged on the visible colour (premultiplied by alpha, so colour hidden in
   * near-transparent pixels doesn't count): small steps that carry on smoothly into the next pixel
   * (`ramps`: shadows, glows, gradients), small steps that don't (`grain`), and steps of more than
   * 8 levels (`edges`). The remaining pairs look exactly equal.
   */
  ramps: number;
  grain: number;
  edges: number;
  /** Distinct colours seen in the sample, counted up to 4096. */
  colours: number;
  /** Pixels sampled. */
  samples: number;
}

/**
 * Measures what kind of picture this is. Photos — even product shots on white — have
 * grain and soft texture everywhere they aren't clipped, so most neighbouring pixels differ a
 * little. Screenshots, logos and flat-colour art are mostly exactly-flat areas, and where
 * neighbours do differ it's a hard edge, anti-aliasing or a smooth shadow, not grain.
 */
export function graphicStats(img: Pixels): GraphicStats {
  assertPixels(img, 'isGraphic');
  const { width, height, data } = img;
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES)));
  const colours = new Set<number>();
  const kinds = [0, 0, 0, 0]; // by StepKind
  let pairs = 0;
  let equal = 0;
  let subtle = 0;
  let samples = 0;

  // One neighbour pair (p, q); r is the pixel after q in the same direction (-1 if none).
  const pair = (p: number, q: number, r: number) => {
    pairs++;
    const d = maxDiff(data, p, q);
    if (d === 0) equal++;
    else if (d <= SUBTLE_STEP) subtle++;
    kinds[visibleStep(data, p, q, r)]!++;
  };

  for (let y = 0; y < height; y += step) {
    const row = y * width;
    const below = y + 1 < height ? row + width : -1;
    const below2 = y + 2 < height ? row + 2 * width : -1;
    for (let x = 0; x < width; x += step) {
      const p = (row + x) * 4;
      samples++;
      if (colours.size < 4096) colours.add(colourKey(data, p));
      if (x + 1 < width) pair(p, p + 4, x + 2 < width ? p + 8 : -1);
      if (below >= 0) pair(p, (below + x) * 4, below2 >= 0 ? (below2 + x) * 4 : -1);
    }
  }

  const differing = pairs - equal;
  const share = (n: number) => (pairs === 0 ? 0 : n / pairs);
  return {
    pairs,
    flat: pairs === 0 ? 1 : equal / pairs,
    subtle: differing === 0 ? 0 : subtle / differing,
    ramps: share(kinds[StepKind.Ramp]!),
    grain: share(kinds[StepKind.Grain]!),
    edges: share(kinds[StepKind.Edge]!),
    colours: colours.size,
    samples,
  };
}

/**
 * True for screenshots, text, logos and flat-colour art (decision D24). Used to pick 4:4:4
 * chroma for JPEG/AVIF (no colour fringes around text) and to suggest PNG or lossless WebP.
 */
export function isGraphic(img: Pixels): boolean {
  const s = graphicStats(img);
  // A single flat colour (or a 1-pixel image) is flat art.
  if (s.pairs === 0 || s.flat === 1) return true;
  // Very few colours in a decent-sized picture: palette art, even with soft edges.
  if (s.samples >= 4096 && s.colours <= 64) return true;
  // Mostly flat areas, and the edges between them are hard rather than grainy.
  if (s.flat >= MIN_FLAT_SHARE && s.subtle < MAX_SUBTLE_SHARE) return true;
  // Mostly flat areas with real edges, softened by shadows or glows rather than grain.
  return isSoftEdgedArt(s);
}

/**
 * P24b: logos with drop shadows, glows or wide anti-aliasing. A shadow is a smooth ramp of small
 * steps, so the hard-edges rule above took such logos for photos and JPEG got 4:2:0 colour
 * fringes. They are still mostly flat and have real edges, and their small steps carry on
 * smoothly; a photo's small steps are grain. Measured (grain as a share of the pairs that aren't
 * flat): soft-shadow logo fixture 0.045, the real-world transparent logo 0.03, text and line art
 * ≤ 0.05; synthetic product-on-white photo 0.12, the real one 0.34, other photos ≥ 0.3. A smooth
 * sky is all ramps and no edges: a gradient, not art.
 */
export function isSoftEdgedArt(s: GraphicStats): boolean {
  const notFlat = s.ramps + s.grain + s.edges;
  return (
    1 - notFlat >= SOFT_MIN_FLAT_SHARE &&
    s.edges >= SOFT_MIN_EDGE_SHARE &&
    s.grain <= SOFT_MAX_GRAIN_SHARE * notFlat
  );
}

/** At least this share of neighbour pairs must be exactly equal for flat-colour art. */
const MIN_FLAT_SHARE = 0.3;
/**
 * Graphics: where neighbours differ, it's almost always a hard edge or anti-aliasing. Measured on
 * the reference set: text screenshot 0.03, logo 0.07 (0.19 after a Lanczos resize). A photo on a
 * clipped white background is just as flat, but its subject is textured: the product-on-white
 * photo scores 0.50 (it was flagged by the old 0.5 limit). 0.3 sits between the two groups.
 */
const MAX_SUBTLE_SHARE = 0.3;
/** Soft-edged art: at least half the pairs look exactly flat (soft-shadow logo 0.91)… */
const SOFT_MIN_FLAT_SHARE = 0.5;
/** …with some real edges (soft-shadow logo 0.013, real-world logo 0.009; a smooth sky 0)… */
const SOFT_MIN_EDGE_SHARE = 0.003;
/** …and grain in at most 8% of the pairs that aren't flat (logos ≤ 0.05, photos ≥ 0.12). */
const SOFT_MAX_GRAIN_SHARE = 0.08;

const _contract: IsGraphic = isGraphic;
void _contract;

function maxDiff(d: Uint8ClampedArray, i: number, j: number): number {
  return Math.max(
    Math.abs(d[i]! - d[j]!),
    Math.abs(d[i + 1]! - d[j + 1]!),
    Math.abs(d[i + 2]! - d[j + 2]!),
    Math.abs(d[i + 3]! - d[j + 3]!),
  );
}

/** Kinds of neighbour step, as indexes into a counts array. */
const StepKind = { Flat: 0, Ramp: 1, Grain: 2, Edge: 3 } as const;
type StepKind = (typeof StepKind)[keyof typeof StepKind];

/** Visible (alpha-premultiplied) value of channel `c` of the pixel at `i`; alpha as it is. */
function visible(d: Uint8ClampedArray, i: number, c: number): number {
  return c === 3 ? d[i + 3]! : (d[i + c]! * d[i + 3]!) / 255;
}

/**
 * The step from pixel p to q as seen (premultiplied): flat, an edge (more than SUBTLE_STEP), or a
 * small step that is part of a ramp (the step q → r is about the same) or grain. With no r (image
 * border) a small step counts as grain.
 */
function visibleStep(d: Uint8ClampedArray, p: number, q: number, r: number): StepKind {
  let step = 0;
  let bend = 0;
  for (let c = 0; c < 4; c++) {
    const a = visible(d, p, c);
    const b = visible(d, q, c);
    step = Math.max(step, Math.abs(a - b));
    if (r >= 0) bend = Math.max(bend, Math.abs(a - 2 * b + visible(d, r, c)));
  }
  step = Math.round(step);
  if (step === 0) return StepKind.Flat;
  if (step > SUBTLE_STEP) return StepKind.Edge;
  return r >= 0 && bend <= RAMP_BEND ? StepKind.Ramp : StepKind.Grain;
}

function colourKey(d: Uint8ClampedArray, i: number): number {
  return ((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!) >>> 0;
}
