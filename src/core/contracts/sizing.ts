// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.
// `declare function` lines from the contract are exported as function types here.

export interface Size { width: number; height: number }

export type ResizeMode = 'none' | 'longest' | 'width' | 'height' | 'percent';
export interface ResizeOptions {
  mode: ResizeMode;
  value: number;          // px, or percent when mode = 'percent'
  upscale?: boolean;      // default false: never enlarge
}

export type FitMode = 'fit' | 'fill';
export type Anchor =
  | 'center' | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export interface ExactOptions {
  width: number;
  height: number;
  fit: FitMode;
  anchor?: Anchor;        // default 'center' (used by 'fill' to choose what to crop, and by 'fit' to place the image)
  upscale?: boolean;      // default false
}

export interface SizeResult extends Size {
  scale: number;          // applied scale factor
  enlarged: boolean;      // scale > 1
  unchanged: boolean;     // output size equals input size
}

export interface Rect { x: number; y: number; width: number; height: number }
export interface Placement {
  canvas: Size;           // final output size (= the exact box)
  source: Rect;           // part of the source to use (whole image for 'fit'; cropped area for 'fill')
  target: Rect;           // where that part is drawn on the canvas
  padded: boolean;        // 'fit' left empty space to fill with a colour
  cropped: boolean;       // 'fill' cut off edges
  enlarged: boolean;
}

/** The one sizing rule. Never stretches. Width/height always >= 1. */
export type FitSize = (src: Size, o: ResizeOptions) => SizeResult;
/** Exact output box via fit (pad) or fill (crop). Never stretches. */
export type ExactPlacement = (src: Size, o: ExactOptions) => Placement;
