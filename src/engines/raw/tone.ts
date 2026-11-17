// From FlashRaw's linear sRGB (half floats, white-balanced, camera colours already converted) to
// upright 8-bit sRGB pixels: exposure, a highlight shoulder, the sRGB curve and a gentle S-curve in
// one 64K lookup table, so every half-float value is converted exactly once and smooth gradients
// stay smooth (no 8-bit maths before the curve, so no banding).
//
// The base exposure and S-curve were fitted to the cameras' own JPEGs (7 fixtures with full-size
// camera JPEGs: best luma SSIM of the downscaled pictures and the same saturation on average), so
// a full develop looks like a normal photo rather than a flat, dark "linear" one.

/**
 * Stops added to every develop. FlashRaw maps the sensor's white level to linear 1.0, which leaves
 * a typical photo 1–1.5 stops darker than the camera's own JPEG; the highlight shoulder below keeps
 * the extra light from clipping.
 */
export const BASE_EXPOSURE = 1.25;

/** Linear value where the highlight shoulder starts (sRGB ≈ 203). Below it the curve is the identity. */
export const SHOULDER_KNEE = 0.6;

export interface ToneOptions {
  /** Total stops applied to the linear values (base + DNG baseline + the user's exposure). */
  exposure: number;
  /**
   * The brightest linear value (after exposure) that should still reach white. Highlights between
   * the knee and this point are compressed instead of clipped. At or below 1, nothing is compressed.
   */
  white: number;
  /** Strength of the S-curve ({@link contrastCurve}); default {@link DEFAULT_CONTRAST}. */
  contrast?: number;
}

/** S-curve strength used for every develop. */
export const DEFAULT_CONTRAST = 0.4;

/** IEEE 754 half float (bits) → number. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** The highlight shoulder: identity up to the knee, then a smooth roll-off that reaches 1 at `white`. */
export function shoulder(x: number, white: number): number {
  if (white <= 1 || x <= SHOULDER_KNEE) return Math.min(x, 1);
  if (x >= white) return 1;
  const k = SHOULDER_KNEE;
  // y = k + d / (1 + d·c): slope 1 at the knee (no kink), y(white) = 1, always rising.
  const c = 1 / (1 - k) - 1 / (white - k);
  const d = x - k;
  return k + d / (1 + d * c);
}

/** Linear → sRGB-encoded, 0–1. */
export function srgbEncode(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 1) return 1;
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/**
 * The white point for {@link ToneOptions}: the sensor's saturation after exposure; with highlight
 * recovery, one stop more, since rebuilt highlights can be brighter than any single channel clipped.
 */
export function toneWhite(exposure: number, highlights: 'clip' | 'recover'): number {
  return 2 ** exposure * (highlights === 'recover' ? 2 : 1);
}

/**
 * A gentle S-curve on the sRGB-encoded value (0–1), like a camera's standard picture style: darker
 * shadows, brighter highlights, slope 1 + c/2 in the middle, never flat or reversed for c < 1.
 */
export function contrastCurve(x: number, c: number): number {
  return x + c * x * (1 - x) * (2 * x - 1);
}

function buildLut(o: ToneOptions, decode: (code: number) => number): Uint8Array {
  const gain = 2 ** o.exposure;
  const c = o.contrast ?? DEFAULT_CONTRAST;
  const lut = new Uint8Array(65536);
  for (let code = 0; code < 65536; code++) {
    const v = decode(code);
    if (Number.isNaN(v) || v <= 0) continue; // negative, zero and NaN → black
    lut[code] = Math.round(contrastCurve(srgbEncode(shoulder(v * gain, o.white)), c) * 255);
  }
  return lut;
}

/** A table from every half-float bit pattern (linear) to the final 8-bit sRGB value. */
export function buildToneLut(o: ToneOptions): Uint8Array {
  return buildLut(o, halfToFloat);
}

/** The same for linear 16-bit integers (0–65535 = 0–1), LibRaw's output. */
export function buildLinearLut(o: ToneOptions): Uint8Array {
  return buildLut(o, (code) => code / 65535);
}

/** For each upright pixel (x, y) of an image stored `sw` × `sh` with EXIF orientation `o`, the stored pixel. */
function sourceIndex(o: number, sw: number, sh: number): (x: number, y: number) => number {
  switch (o) {
    case 2:
      return (x, y) => y * sw + (sw - 1 - x);
    case 3:
      return (x, y) => (sh - 1 - y) * sw + (sw - 1 - x);
    case 4:
      return (x, y) => (sh - 1 - y) * sw + x;
    case 5:
      return (x, y) => x * sw + y;
    case 6:
      return (x, y) => (sh - 1 - x) * sw + y;
    case 7:
      return (x, y) => (sh - 1 - x) * sw + (sw - 1 - y);
    case 8:
      return (x, y) => x * sw + (sw - 1 - y);
    default:
      return (x, y) => y * sw + x;
  }
}

export interface Developed {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/**
 * Interleaved RGB half floats (`sw` × `sh`, as stored on the sensor) → upright RGBA 8-bit, with the
 * EXIF orientation applied in the same pass (pure pixel moves: no second copy, no resampling).
 */
export function developPixels(
  rgb: Uint16Array,
  sw: number,
  sh: number,
  orientation: number,
  lut: Uint8Array,
): Developed {
  const swap = orientation >= 5 && orientation <= 8;
  const width = swap ? sh : sw;
  const height = swap ? sw : sh;
  const data = new Uint8ClampedArray(width * height * 4);
  if (orientation < 2 || orientation > 8) {
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      data[i] = lut[rgb[j]!]!;
      data[i + 1] = lut[rgb[j + 1]!]!;
      data[i + 2] = lut[rgb[j + 2]!]!;
      data[i + 3] = 255;
    }
    return { data, width, height };
  }
  const from = sourceIndex(orientation, sw, sh);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      const j = from(x, y) * 3;
      data[i] = lut[rgb[j]!]!;
      data[i + 1] = lut[rgb[j + 1]!]!;
      data[i + 2] = lut[rgb[j + 2]!]!;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}
