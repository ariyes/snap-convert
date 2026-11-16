// Measurements for the crispness tests (image quality standard, D24). Test-only; not used by app code.

/** Rec. 601 luma per pixel. */
export function luma(img: ImageData): Float32Array {
  const out = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * (d[i * 4] ?? 0) + 0.587 * (d[i * 4 + 1] ?? 0) + 0.114 * (d[i * 4 + 2] ?? 0);
  }
  return out;
}

/** Edge-contrast score: mean absolute luma difference between horizontal and vertical neighbours. Higher = crisper. */
export function edgeContrast(img: ImageData): number {
  const l = luma(img);
  const w = img.width;
  const h = img.height;
  let sum = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v = l[y * w + x] ?? 0;
      sum += Math.abs((l[y * w + x + 1] ?? 0) - v) + Math.abs((l[(y + 1) * w + x] ?? 0) - v);
    }
  }
  return sum / ((w - 1) * (h - 1));
}

/**
 * Plain bilinear downscale as image libraries implement it (triangle filter whose support grows
 * with the reduction, e.g. Pillow's BILINEAR) — the reference our output must beat for sharpness.
 */
export function bilinearDownscale(img: ImageData, toW: number, toH: number): ImageData {
  const pass = (src: Float32Array, sw: number, sh: number, dw: number, horizontal: boolean): Float32Array => {
    const len = horizontal ? sw : sh;
    const other = horizontal ? sh : sw;
    const scale = len / dw;
    const support = Math.max(1, scale);
    const out = new Float32Array((horizontal ? dw * sh : sw * dw) * 4);
    for (let o = 0; o < dw; o++) {
      const center = (o + 0.5) * scale;
      const lo = Math.max(0, Math.floor(center - support));
      const hi = Math.min(len - 1, Math.ceil(center + support));
      const weights: number[] = [];
      let total = 0;
      for (let s = lo; s <= hi; s++) {
        const wgt = Math.max(0, 1 - Math.abs((s + 0.5 - center) / support));
        weights.push(wgt);
        total += wgt;
      }
      for (let k = 0; k < other; k++) {
        for (let c = 0; c < 4; c++) {
          let acc = 0;
          for (let s = lo; s <= hi; s++) {
            const idx = horizontal ? (k * sw + s) * 4 + c : (s * sw + k) * 4 + c;
            acc += (src[idx] ?? 0) * (weights[s - lo] ?? 0);
          }
          const dst = horizontal ? (k * dw + o) * 4 + c : (o * sw + k) * 4 + c;
          out[dst] = acc / total;
        }
      }
    }
    return out;
  };
  const h1 = pass(Float32Array.from(img.data), img.width, img.height, toW, true);
  const v1 = pass(h1, toW, img.height, toH, false);
  const out = new ImageData(toW, toH);
  for (let i = 0; i < v1.length; i++) out.data[i] = Math.round(v1[i] ?? 0);
  return out;
}

/** Naive 4-tap bilinear sampling with no pre-filter (what a canvas does with low smoothing quality). Aliases. */
export function naiveBilinear(img: ImageData, toW: number, toH: number): ImageData {
  const out = new ImageData(toW, toH);
  const sx = img.width / toW;
  const sy = img.height / toH;
  for (let y = 0; y < toH; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < toW; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const p = (xx: number, yy: number) => img.data[(yy * img.width + xx) * 4 + c] ?? 0;
        const top = p(x0, y0) * (1 - tx) + p(x1, y0) * tx;
        const bottom = p(x0, y1) * (1 - tx) + p(x1, y1) * tx;
        out.data[(y * toW + x) * 4 + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return out;
}

/**
 * Halo width across one edge: walking a luma profile, the longest run of pixels that overshoot
 * outside [low − tolerance, high + tolerance] (the two flat levels either side of the edge).
 */
export function longestOvershootRun(profile: readonly number[], low: number, high: number, tolerance: number): number {
  let longest = 0;
  let run = 0;
  for (const v of profile) {
    if (v > high + tolerance || v < low - tolerance) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return longest;
}

/** Largest overshoot beyond [low, high] in levels (0 if none). */
export function maxOvershoot(profile: readonly number[], low: number, high: number): number {
  return profile.reduce((m, v) => Math.max(m, v - high, low - v), 0);
}

/** Luma row (x0..x1 inclusive) at y. */
export function lumaRow(img: ImageData, y: number, x0: number, x1: number): number[] {
  const l = luma(img);
  const row: number[] = [];
  for (let x = x0; x <= x1; x++) row.push(l[y * img.width + x] ?? 0);
  return row;
}

/** Standard deviation of luma over pixels where `inside(x, y)` is true (moiré shows as structure = spread). */
export function lumaStdDev(img: ImageData, inside: (x: number, y: number) => boolean): number {
  const l = luma(img);
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!inside(x, y)) continue;
      const v = l[y * img.width + x] ?? 0;
      n++;
      sum += v;
      sq += v * v;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

/** Largest difference between neighbouring pixels in any colour channel, inside a region. Banding shows as big steps in smooth areas. */
export function maxNeighbourStep(img: ImageData, x0 = 0, y0 = 0, x1 = img.width - 1, y1 = img.height - 1): number {
  const d = img.data;
  const w = img.width;
  let max = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] ?? 0;
        if (x < x1) max = Math.max(max, Math.abs((d[i + 4 + c] ?? 0) - v));
        if (y < y1) max = Math.max(max, Math.abs((d[i + w * 4 + c] ?? 0) - v));
      }
    }
  }
  return max;
}
