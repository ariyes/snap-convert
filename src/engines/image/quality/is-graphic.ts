import type { IsGraphic } from '@/core/contracts/image';
import { assertPixels, type Pixels } from './pixels';

/** Neighbour pairs differing by at most this much (largest channel) count as fine texture. */
const SUBTLE_STEP = 8;
/** Sample about this many pixels at most, so a 12 MP image is checked in a few milliseconds. */
const MAX_SAMPLES = 1_000_000;

export interface GraphicStats {
  /** Neighbour pairs looked at (each sampled pixel vs. its right and lower neighbour). */
  pairs: number;
  /** Share of pairs whose colours are exactly equal (flat areas). */
  flat: number;
  /** Share of the non-equal pairs that differ only slightly (photo grain, smooth gradients). */
  subtle: number;
  /** Distinct colours seen in the sample, counted up to 4096. */
  colours: number;
  /** Pixels sampled. */
  samples: number;
}

/**
 * Measures what kind of picture this is. Photos — even product shots on white — have
 * grain and soft texture everywhere they aren't clipped, so most neighbouring pixels differ a
 * little. Screenshots, logos and flat-colour art are mostly exactly-flat areas, and where
 * neighbours do differ it's a hard edge or anti-aliasing, not grain.
 */
export function graphicStats(img: Pixels): GraphicStats {
  assertPixels(img, 'isGraphic');
  const { width, height, data } = img;
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES)));
  const colours = new Set<number>();
  let pairs = 0;
  let equal = 0;
  let subtle = 0;
  let samples = 0;

  for (let y = 0; y < height; y += step) {
    const row = y * width;
    const below = y + 1 < height ? row + width : -1;
    for (let x = 0; x < width; x += step) {
      const p = (row + x) * 4;
      samples++;
      if (colours.size < 4096) colours.add(colourKey(data, p));
      if (x + 1 < width) {
        const d = maxDiff(data, p, p + 4);
        pairs++;
        if (d === 0) equal++;
        else if (d <= SUBTLE_STEP) subtle++;
      }
      if (below >= 0) {
        const d = maxDiff(data, p, (below + x) * 4);
        pairs++;
        if (d === 0) equal++;
        else if (d <= SUBTLE_STEP) subtle++;
      }
    }
  }

  const differing = pairs - equal;
  return {
    pairs,
    flat: pairs === 0 ? 1 : equal / pairs,
    subtle: differing === 0 ? 0 : subtle / differing,
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
  return s.flat >= MIN_FLAT_SHARE && s.subtle < MAX_SUBTLE_SHARE;
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

function colourKey(d: Uint8ClampedArray, i: number): number {
  return ((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!) >>> 0;
}
