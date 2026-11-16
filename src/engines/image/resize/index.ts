// M4 pixel resize (P05): high-quality Lanczos3 resampling with pica, plus light sharpening
// scaled to how much the image shrank (image quality standard, decision D24).
// The target size always comes from src/core/sizing — this module never decides sizes.

import type { ResizePixels } from '@/core/contracts/image';
import type { Size } from '@/core/contracts/sizing';
import type { Pica } from 'pica/pica_main';

export interface Sharpening {
  unsharpAmount: number;
  unsharpRadius: number;
  unsharpThreshold: number;
}

/** No sharpening below this reduction ratio: small reductions stay as crisp as the source. */
export const SHARPEN_FROM_RATIO = 1.25;
/** Reduction ratio at which sharpening reaches its maximum. */
export const SHARPEN_FULL_RATIO = 8;
/** pica unsharp-mask settings at the maximum (amount in %, Gaussian radius in px, threshold in levels). */
export const SHARPEN_MAX = { amount: 80, radius: 0.6, threshold: 2 } as const;

const NO_SHARPENING: Sharpening = { unsharpAmount: 0, unsharpRadius: 0, unsharpThreshold: 0 };

/**
 * Post-downscale sharpening for a reduction ratio (source size / output size, ≥ 1).
 * None below {@link SHARPEN_FROM_RATIO}; then rising on a log scale up to {@link SHARPEN_MAX}
 * at {@link SHARPEN_FULL_RATIO}× and above. Small radius and a threshold keep halos and noise down.
 */
export function sharpeningFor(ratio: number): Sharpening {
  if (!(ratio >= SHARPEN_FROM_RATIO)) return NO_SHARPENING;
  const t = Math.min(
    1,
    Math.log(ratio / SHARPEN_FROM_RATIO) / Math.log(SHARPEN_FULL_RATIO / SHARPEN_FROM_RATIO),
  );
  const amount = Math.round(SHARPEN_MAX.amount * t);
  if (amount === 0) return NO_SHARPENING;
  return {
    unsharpAmount: amount,
    unsharpRadius: SHARPEN_MAX.radius,
    unsharpThreshold: SHARPEN_MAX.threshold,
  };
}

let picaInstance: Promise<Pica> | undefined;

/** One shared pica instance, loaded on first use. Math only (JS + WebAssembly): we are already in a worker. */
function getPica(): Promise<Pica> {
  picaInstance ??= import('pica/pica_main')
    .then(async ({ default: createPica }) => createPica({ features: ['js', 'wasm'] }).init())
    .catch((error: unknown) => {
      picaInstance = undefined;
      throw error;
    });
  return picaInstance;
}

function assertSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid resize target ${width}×${height}`);
  }
}

/**
 * Resizes RGBA pixels to exactly `to` (computed by src/core/sizing) with pica's Lanczos3 filter.
 * Downscales get ratio-scaled sharpening; same-size input is returned unchanged.
 */
export const resizePixels: ResizePixels = async (img, to) => {
  assertSize(to.width, to.height);
  if (to.width === img.width && to.height === img.height) return img;
  const ratio = Math.max(img.width / to.width, img.height / to.height);
  return resizeWithSharpening(img, to, sharpeningFor(ratio));
};

/** Lanczos3 resize with explicit sharpening settings (resizePixels picks them from the ratio). */
export async function resizeWithSharpening(
  img: ImageData,
  to: Size,
  sharpening: Sharpening,
): Promise<ImageData> {
  assertSize(to.width, to.height);
  const pica = await getPica();
  // pica's WebAssembly path reads the whole underlying buffer, so hand it an exact-size one.
  const whole = img.data.byteOffset === 0 && img.data.buffer.byteLength === img.data.byteLength;
  const src = whole ? img.data : img.data.slice();
  const out = await pica.resizeBuffer({
    src,
    width: img.width,
    height: img.height,
    toWidth: to.width,
    toHeight: to.height,
    filter: 'lanczos3',
    ...sharpening,
  });
  const data = new Uint8ClampedArray(out.buffer as ArrayBuffer, out.byteOffset, out.byteLength);
  return new ImageData(data, to.width, to.height);
}
