// What the resize settings will do to one image. Every number here comes from the sizing rule
// (src/core/sizing): this module only asks it and reads the answer.

import { describe, exactPlacement, fitSize, type Size } from '@/core/sizing';
import { toJobSizing, type ResizeValues } from './values';

export interface SizePlan {
  /** Output size from fitSize / exactPlacement. */
  output: Size;
  /** describe(source, result), e.g. "4032×3024 → 1920×1440". */
  text: string;
  /** The image is made bigger (only possible with "Enlarge smaller images" on). */
  enlarged: boolean;
  /** The settings ask for a bigger size, but enlarging is off, so the image keeps its size. */
  notEnlarged: boolean;
  /** Exact size, Fit: empty space around the image is filled with the padding colour. */
  padded: boolean;
  /** Exact size, Fill: edges are trimmed. */
  cropped: boolean;
}

/**
 * Plans the output size of an image of `source` size. Returns null when the source size or a
 * setting is invalid (fitSize / exactPlacement throw a RangeError).
 * `optional`: the tool has an "Also resize" checkbox, so `resizeEnabled` applies.
 */
export function planSize(
  source: Size,
  values: ResizeValues,
  options?: { optional?: boolean },
): SizePlan | null {
  try {
    const sizing = toJobSizing(values, options);
    if (sizing.exact) {
      const placement = exactPlacement(source, sizing.exact);
      const unlimited = exactPlacement(source, { ...sizing.exact, upscale: true });
      return {
        output: placement.canvas,
        text: describe(source, placement),
        enlarged: placement.enlarged,
        notEnlarged: !placement.enlarged && unlimited.enlarged,
        padded: placement.padded,
        cropped: placement.cropped,
      };
    }
    const resize = sizing.resize ?? { mode: 'none' as const, value: 1 };
    const result = fitSize(source, resize);
    const unlimited = fitSize(source, { ...resize, upscale: true });
    return {
      output: { width: result.width, height: result.height },
      text: describe(source, result),
      enlarged: result.enlarged,
      notEnlarged: !result.enlarged && unlimited.enlarged,
      padded: false,
      cropped: false,
    };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
