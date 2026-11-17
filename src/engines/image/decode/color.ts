// Colour conversion to sRGB for pixels we decode ourselves (HEIC via libheif, AVIF via jSquash).
// Browser decoders already colour-manage; WebAssembly decoders hand back the file's own RGB
// values, so an iPhone's Display P3 photo would look dull if we didn't convert it.
// Supports matrix/TRC ICC profiles (Display P3, Adobe RGB, …) and nclx colour boxes.

import type { Nclx } from './container';

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3]; // rows
type Curve = (x: number) => number;

/** ICC's sRGB (D50-adapted) matrix columns, as stored in the standard sRGB IEC61966-2.1 profile. */
const SRGB_D50: Mat3 = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];

const srgbToLinear: Curve = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb: Curve = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function mulVec(m: Mat3, v: Vec3): Vec3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  return [
    a * v[0] + b * v[1] + c * v[2],
    d * v[0] + e * v[1] + f * v[2],
    g * v[0] + h * v[1] + i * v[2],
  ];
}

function transpose(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  return [
    [a, d, g],
    [b, e, h],
    [c, f, i],
  ];
}

/** a × b: each column of the result is a × (column of b). */
function mul(a: Mat3, b: Mat3): Mat3 {
  const [c0, c1, c2] = transpose(b);
  return transpose([mulVec(a, c0), mulVec(a, c1), mulVec(a, c2)]);
}

function invert(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** RGB → XYZ matrix from xy chromaticities of the primaries and the white point. */
function rgbToXyz(
  r: [number, number],
  g: [number, number],
  b: [number, number],
  w: [number, number],
): Mat3 {
  const xyz = ([x, y]: [number, number]): Vec3 => [x / y, 1, (1 - x - y) / y];
  const prim = transpose([xyz(r), xyz(g), xyz(b)]); // primaries as columns
  const [sr, sg, sb] = mulVec(invert(prim), xyz(w)); // scale so that RGB 1,1,1 is the white point
  const [[a, b2, c], [d, e, f], [g2, h, i]] = prim;
  return [
    [a * sr, b2 * sg, c * sb],
    [d * sr, e * sg, f * sb],
    [g2 * sr, h * sg, i * sb],
  ];
}

const D65: [number, number] = [0.3127, 0.329];
const SRGB_D65 = rgbToXyz([0.64, 0.33], [0.3, 0.6], [0.15, 0.06], D65);

/** A conversion: decode each channel to linear light, mix with a 3×3 matrix, encode as sRGB. */
export interface ColorTransform {
  curves: [Curve, Curve, Curve];
  matrix: Mat3;
}

// ---------- ICC ----------

function s15(view: DataView, at: number): number {
  return view.getInt32(at) / 65536;
}

function readCurve(view: DataView, at: number, size: number): Curve | undefined {
  const type = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + at, 4));
  if (type === 'curv') {
    const n = view.getUint32(at + 8);
    if (n === 0) return (x) => x;
    if (n === 1) {
      const gamma = view.getUint16(at + 12) / 256;
      return (x) => x ** gamma;
    }
    if (12 + 2 * n > size) return undefined;
    const table = new Float64Array(n);
    for (let i = 0; i < n; i++) table[i] = view.getUint16(at + 12 + 2 * i) / 65535;
    return (x) => {
      const pos = Math.min(Math.max(x, 0), 1) * (n - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, n - 1);
      const t = pos - lo;
      return (table[lo] ?? 0) * (1 - t) + (table[hi] ?? 0) * t;
    };
  }
  if (type === 'para') {
    const fn = view.getUint16(at + 8);
    const count = [1, 3, 4, 5, 7][fn];
    if (count === undefined || 12 + 4 * count > size) return undefined;
    const p = Array.from({ length: 7 }, (_, i) => (i < count ? s15(view, at + 12 + 4 * i) : 0));
    const [g, a, b, c, d, e, f] = p as [number, number, number, number, number, number, number];
    switch (fn) {
      case 0:
        return (x) => x ** g;
      case 1:
        return (x) => (x >= -b / a ? (a * x + b) ** g : 0);
      case 2:
        return (x) => (x >= -b / a ? (a * x + b) ** g + c : c);
      case 3:
        return (x) => (x >= d ? (a * x + b) ** g : c * x);
      default:
        return (x) => (x >= d ? (a * x + b) ** g + e : c * x + f);
    }
  }
  return undefined;
}

/**
 * Builds a transform from an RGB matrix/TRC ICC profile to sRGB. Returns `undefined` when the
 * profile is already sRGB (nothing to do) or isn't a kind we can apply (LUT-based, CMYK, grey).
 */
export function iccToSrgb(icc: Uint8Array): ColorTransform | undefined {
  if (icc.length < 132) return undefined;
  const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const tag4 = (at: number) => String.fromCharCode(...icc.subarray(at, at + 4));
  if (tag4(16) !== 'RGB ' || tag4(20) !== 'XYZ ') return undefined;
  const count = view.getUint32(128);
  const tags = new Map<string, { at: number; size: number }>();
  for (let i = 0; i < count && 132 + 12 * (i + 1) <= icc.length; i++) {
    const base = 132 + 12 * i;
    const at = view.getUint32(base + 4);
    const size = view.getUint32(base + 8);
    if (at + size <= icc.length) tags.set(tag4(base), { at, size });
  }
  const xyz = (sig: string): Vec3 | undefined => {
    const t = tags.get(sig);
    if (!t || t.size < 20 || tag4(t.at) !== 'XYZ ') return undefined;
    return [s15(view, t.at + 8), s15(view, t.at + 12), s15(view, t.at + 16)];
  };
  const curve = (sig: string) => {
    const t = tags.get(sig);
    return t ? readCurve(view, t.at, t.size) : undefined;
  };
  const r = xyz('rXYZ');
  const g = xyz('gXYZ');
  const b = xyz('bXYZ');
  const rc = curve('rTRC');
  const gc = curve('gTRC');
  const bc = curve('bTRC');
  if (!r || !g || !b || !rc || !gc || !bc) return undefined;
  const source: Mat3 = [
    [r[0], g[0], b[0]],
    [r[1], g[1], b[1]],
    [r[2], g[2], b[2]],
  ];
  const matrix = mul(invert(SRGB_D50), source);
  const transform: ColorTransform = { curves: [rc, gc, bc], matrix };
  return isIdentity(transform) ? undefined : transform;
}

/** nclx colour boxes (no ICC profile). Only SDR transfers; HDR (PQ / HLG) is left as is. */
export function nclxToSrgb(nclx: Nclx): ColorTransform | undefined {
  const sdr = [1, 6, 13, 14, 15].includes(nclx.transfer) || nclx.transfer === 2; // 2 = unspecified
  if (!sdr) return undefined;
  let source: Mat3 | undefined;
  if (nclx.primaries === 12)
    source = rgbToXyz([0.68, 0.32], [0.265, 0.69], [0.15, 0.06], D65); // Display P3
  else if (nclx.primaries === 9)
    source = rgbToXyz([0.708, 0.292], [0.17, 0.797], [0.131, 0.046], D65); // BT.2020
  if (!source) return undefined; // BT.709 / sRGB / unspecified: already right
  return {
    curves: [srgbToLinear, srgbToLinear, srgbToLinear],
    matrix: mul(invert(SRGB_D65), source),
  };
}

// ---------- PNG cHRM / gAMA ----------

/** Bradford cone response matrix (chromatic adaptation between white points). */
const BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

/** XYZ → XYZ matrix that maps white `from` onto white `to` (xy chromaticities). */
function adapt(from: [number, number], to: [number, number]): Mat3 {
  const xyz = ([x, y]: [number, number]): Vec3 => [x / y, 1, (1 - x - y) / y];
  const a = mulVec(BRADFORD, xyz(from));
  const b = mulVec(BRADFORD, xyz(to));
  const scale: Mat3 = [
    [b[0] / a[0], 0, 0],
    [0, b[1] / a[1], 0],
    [0, 0, b[2] / a[2]],
  ];
  return mul(invert(BRADFORD), mul(scale, BRADFORD));
}

/** xy chromaticities of a PNG cHRM chunk. */
export interface Chromaticities {
  white: [number, number];
  red: [number, number];
  green: [number, number];
  blue: [number, number];
}

function validXy([x, y]: [number, number]): boolean {
  return x > 0 && y > 0 && x + y <= 1;
}

/** libpng's PNG_GAMMA_THRESHOLD: a gAMA within 5 % of 1/2.2 counts as plain sRGB. */
const GAMMA_THRESHOLD = 0.05;

/**
 * Colours of a PNG without an ICC profile or sRGB chunk, as Chromium reads them (checked pixel
 * for pixel in fallback.browser.test.ts): gAMA gives a pure power curve; with a valid cHRM its
 * primaries apply too. cHRM without gAMA is ignored, and a lone gAMA within 5 % of 1/2.2 means
 * sRGB. `undefined` when nothing needs converting.
 */
export function pngChunksToSrgb(
  gamma: number | undefined,
  chrm: Chromaticities | undefined,
): ColorTransform | undefined {
  if (gamma === undefined || !(gamma > 0) || !Number.isFinite(1 / gamma)) return undefined;
  const c = chrm && [chrm.white, chrm.red, chrm.green, chrm.blue].every(validXy) ? chrm : undefined;
  if (!c && Math.abs(gamma * 2.2 - 1) < GAMMA_THRESHOLD) return undefined;
  const curve: Curve = (x) => x ** (1 / gamma);
  let matrix: Mat3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  if (c) {
    const source = mul(adapt(c.white, D65), rgbToXyz(c.red, c.green, c.blue, c.white));
    matrix = mul(invert(SRGB_D65), source);
  }
  const transform: ColorTransform = { curves: [curve, curve, curve], matrix };
  return isIdentity(transform) ? undefined : transform;
}

function isIdentity(t: ColorTransform): boolean {
  const close = t.matrix.every((row, i) =>
    row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 0.002),
  );
  if (!close) return false;
  for (let i = 0; i <= 16; i++) {
    const x = i / 16;
    if (t.curves.some((c) => Math.abs(c(x) - srgbToLinear(x)) > 0.002)) return false;
  }
  return true;
}

const ENCODE_STEPS = 65535;
let encodeLut: Uint8Array | undefined;

/** Converts pixels to sRGB in place. Alpha is untouched. */
export function applyColorTransform(img: ImageData, t: ColorTransform): void {
  const decode = t.curves.map((c) => {
    const lut = new Float32Array(256);
    for (let v = 0; v < 256; v++) lut[v] = c(v / 255);
    return lut;
  }) as [Float32Array, Float32Array, Float32Array];
  if (!encodeLut) {
    encodeLut = new Uint8Array(ENCODE_STEPS + 1);
    for (let i = 0; i <= ENCODE_STEPS; i++)
      encodeLut[i] = Math.round(linearToSrgb(i / ENCODE_STEPS) * 255);
  }
  const enc = encodeLut;
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = t.matrix;
  const [dr, dg, db] = decode;
  const d = img.data;
  const toIndex = (v: number) =>
    v <= 0 ? 0 : v >= 1 ? ENCODE_STEPS : (v * ENCODE_STEPS + 0.5) | 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = dr[d[i] ?? 0] ?? 0;
    const g = dg[d[i + 1] ?? 0] ?? 0;
    const b = db[d[i + 2] ?? 0] ?? 0;
    d[i] = enc[toIndex(m00 * r + m01 * g + m02 * b)] ?? 0;
    d[i + 1] = enc[toIndex(m10 * r + m11 * g + m12 * b)] ?? 0;
    d[i + 2] = enc[toIndex(m20 * r + m21 * g + m22 * b)] ?? 0;
  }
}
