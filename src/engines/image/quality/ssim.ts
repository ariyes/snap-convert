import type { Ssim } from '@/core/contracts/image';
import { assertPixels, type Pixels } from './pixels';

/** Standard SSIM constants for 8-bit data: (0.01 · 255)² and (0.03 · 255)². */
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** Windows are 8×8 pixels, moved 4 pixels at a time (each window = 2×2 blocks of 4×4). */
const BLOCK = 4;

/**
 * Luma SSIM (Wang et al. 2004) over 8×8 windows with a 4-pixel step, averaged over the image.
 * Returns 0–1 (1 = identical). Both images must be the same size.
 *
 * Luma is BT.601 (0.299 R + 0.587 G + 0.114 B). Transparent pixels are composited over white
 * first, so changes hidden under alpha 0 don't count but visible alpha changes do.
 *
 * Fast enough for a 12 MP image in a worker: one pass collects per-4×4-block sums of
 * x, y, x², y² and xy; each window then adds up four blocks. No downsampling is needed,
 * so small artefacts (8 px JPEG blocks, ringing) are scored at full resolution.
 */
export function ssim(a: Pixels, b: Pixels): number {
  assertPixels(a, 'ssim (first image)');
  assertPixels(b, 'ssim (second image)');
  if (a.width !== b.width || a.height !== b.height) {
    throw new RangeError(
      `ssim: images differ in size (${a.width}×${a.height} vs ${b.width}×${b.height})`,
    );
  }
  const { width, height } = a;

  // Too small for an 8×8 window: score the whole image as one window.
  if (width < 2 * BLOCK || height < 2 * BLOCK) {
    return wholeImageSsim(a.data, b.data, width * height);
  }

  const bw = Math.floor(width / BLOCK);
  const bh = Math.floor(height / BLOCK);
  const n = bw * bh;
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sxx = new Float64Array(n);
  const syy = new Float64Array(n);
  const sxy = new Float64Array(n);
  const da = a.data;
  const db = b.data;

  for (let y = 0; y < bh * BLOCK; y++) {
    const blockRow = ((y / BLOCK) | 0) * bw;
    let i = y * width * 4;
    for (let bx = 0; bx < bw; bx++) {
      let px = 0;
      let py = 0;
      let pxx = 0;
      let pyy = 0;
      let pxy = 0;
      for (let k = 0; k < BLOCK; k++, i += 4) {
        const lx = luma(da, i);
        const ly = luma(db, i);
        px += lx;
        py += ly;
        pxx += lx * lx;
        pyy += ly * ly;
        pxy += lx * ly;
      }
      const j = blockRow + bx;
      sx[j]! += px;
      sy[j]! += py;
      sxx[j]! += pxx;
      syy[j]! += pyy;
      sxy[j]! += pxy;
    }
  }

  const count = (2 * BLOCK) ** 2;
  let total = 0;
  let windows = 0;
  for (let wy = 0; wy < bh - 1; wy++) {
    for (let wx = 0; wx < bw - 1; wx++) {
      const j0 = wy * bw + wx;
      const j1 = j0 + 1;
      const j2 = j0 + bw;
      const j3 = j2 + 1;
      const mx = (sx[j0]! + sx[j1]! + sx[j2]! + sx[j3]!) / count;
      const my = (sy[j0]! + sy[j1]! + sy[j2]! + sy[j3]!) / count;
      const vx = (sxx[j0]! + sxx[j1]! + sxx[j2]! + sxx[j3]!) / count - mx * mx;
      const vy = (syy[j0]! + syy[j1]! + syy[j2]! + syy[j3]!) / count - my * my;
      const cxy = (sxy[j0]! + sxy[j1]! + sxy[j2]! + sxy[j3]!) / count - mx * my;
      total += windowSsim(mx, my, vx, vy, cxy);
      windows++;
    }
  }
  return clamp01(total / windows);
}

// Compile-time check that the implementation matches the shared contract.
const _contract: Ssim = ssim;
void _contract;

function wholeImageSsim(da: Uint8ClampedArray, db: Uint8ClampedArray, pixels: number): number {
  let px = 0;
  let py = 0;
  let pxx = 0;
  let pyy = 0;
  let pxy = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const lx = luma(da, i);
    const ly = luma(db, i);
    px += lx;
    py += ly;
    pxx += lx * lx;
    pyy += ly * ly;
    pxy += lx * ly;
  }
  const mx = px / pixels;
  const my = py / pixels;
  return clamp01(
    windowSsim(mx, my, pxx / pixels - mx * mx, pyy / pixels - my * my, pxy / pixels - mx * my),
  );
}

function windowSsim(mx: number, my: number, vx: number, vy: number, cxy: number): number {
  return ((2 * mx * my + C1) * (2 * cxy + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
}

/** BT.601 luma of pixel `i`, composited over white by its alpha. */
function luma(d: Uint8ClampedArray, i: number): number {
  const y = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  const alpha = d[i + 3]!;
  return alpha === 255 ? y : (y * alpha + 255 * (255 - alpha)) / 255;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
