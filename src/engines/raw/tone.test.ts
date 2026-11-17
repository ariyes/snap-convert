import { describe, expect, it } from 'vitest';
import {
  buildLinearLut,
  buildToneLut,
  contrastCurve,
  developPixels,
  halfToFloat,
  shoulder,
  SHOULDER_KNEE,
  srgbEncode,
  toneWhite,
} from './tone';

/** number → half-float bits (round to nearest; enough for tests). */
function toHalf(v: number): number {
  const f = new Float32Array([v]);
  const i = new Uint32Array(f.buffer)[0]!;
  const sign = (i >>> 16) & 0x8000;
  const exp = ((i >>> 23) & 0xff) - 127 + 15;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | Math.round((i & 0x7fffff) / 0x2000);
}

describe('halfToFloat', () => {
  it('reads normal, subnormal and special values', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0x3800)).toBe(0.5);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0x7e00)).toBeNaN();
    expect(halfToFloat(0)).toBe(0);
  });
});

describe('shoulder', () => {
  it('is the identity below the knee and reaches 1 exactly at the white point', () => {
    expect(shoulder(0.3, 2)).toBe(0.3);
    expect(shoulder(SHOULDER_KNEE, 2)).toBeCloseTo(SHOULDER_KNEE, 12);
    expect(shoulder(2, 2)).toBe(1);
    expect(shoulder(5, 2)).toBe(1);
  });

  it('rises smoothly (no kink at the knee, never flat, never above 1)', () => {
    let prev = 0;
    for (let x = 0.001; x < 2; x += 0.001) {
      const y = shoulder(x, 2);
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
    const e = 1e-6;
    const slope = (shoulder(SHOULDER_KNEE + e, 2) - shoulder(SHOULDER_KNEE, 2)) / e;
    expect(slope).toBeCloseTo(1, 3);
  });

  it('just clips when nothing is above white', () => {
    expect(shoulder(0.8, 1)).toBe(0.8);
    expect(shoulder(1.3, 1)).toBe(1);
    expect(shoulder(0.4, 0.5)).toBe(0.4);
  });
});

describe('contrastCurve', () => {
  it('keeps black, mid-grey and white, darkens shadows and lifts highlights, stays monotonic', () => {
    expect(contrastCurve(0, 0.4)).toBe(0);
    expect(contrastCurve(1, 0.4)).toBe(1);
    expect(contrastCurve(0.5, 0.4)).toBe(0.5);
    expect(contrastCurve(0.25, 0.4)).toBeLessThan(0.25);
    expect(contrastCurve(0.75, 0.4)).toBeGreaterThan(0.75);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.001) {
      const y = contrastCurve(x, 0.4);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });
});

describe('tone tables', () => {
  it('map linear values through exposure, sRGB and the S-curve', () => {
    const lut = buildToneLut({ exposure: 0, white: 1, contrast: 0 });
    expect(lut[toHalf(0)]).toBe(0);
    expect(lut[toHalf(-0.5)]).toBe(0);
    expect(lut[toHalf(1)]).toBe(255);
    expect(lut[toHalf(4)]).toBe(255);
    expect(lut[0x7e00]).toBe(0); // NaN
    // 18 % grey → sRGB 118
    expect(lut[toHalf(0.18)]).toBeCloseTo(Math.round(srgbEncode(0.18) * 255), -0.5);
    // +1 stop doubles the linear value
    const plus1 = buildToneLut({ exposure: 1, white: 1, contrast: 0 });
    expect(plus1[toHalf(0.09)]).toBeCloseTo(lut[toHalf(0.18)]!, -0.5);
  });

  it('never lose a level in a smooth ramp: 8-bit output rises without gaps of more than one step in the mid-tones', () => {
    const exposure = 1.25;
    const lut = buildToneLut({ exposure, white: toneWhite(exposure, 'clip') });
    let prev = lut[toHalf(0.02)]!;
    for (let v = 0.02; v < 0.3; v += 0.0002) {
      const y = lut[toHalf(v)]!;
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(y - prev).toBeLessThanOrEqual(2);
      prev = y;
    }
  });

  it('LibRaw 16-bit linear table matches the half-float one', () => {
    const o = { exposure: 1, white: 2 };
    const half = buildToneLut(o);
    const lin = buildLinearLut(o);
    for (const v of [0.01, 0.1, 0.25, 0.5, 0.9]) {
      expect(Math.abs(half[toHalf(v)]! - lin[Math.round(v * 65535)]!)).toBeLessThanOrEqual(1);
    }
  });

  it('recover keeps one more stop of highlights', () => {
    expect(toneWhite(1, 'clip')).toBe(2);
    expect(toneWhite(1, 'recover')).toBe(4);
  });
});

describe('developPixels', () => {
  // 3 × 2 image, stored pixel i has value i in every channel (lut = identity on low codes)
  const lut = new Uint8Array(65536).map((_, i) => i & 0xff);
  const rgb = new Uint16Array(18);
  for (let i = 0; i < 6; i++) rgb.set([i, i, i], i * 3);
  const values = (d: { data: Uint8ClampedArray }) => [...d.data].filter((_, i) => i % 4 === 0);

  it('converts without moving pixels for orientation 1', () => {
    const out = developPixels(rgb, 3, 2, 1, lut);
    expect([out.width, out.height]).toEqual([3, 2]);
    expect(values(out)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.data[3]).toBe(255);
  });

  it('turns the picture upright for orientation 6 (90° clockwise) and 8', () => {
    // stored:  0 1 2      upright (6):  3 0
    //          3 4 5                    4 1
    //                                   5 2
    const six = developPixels(rgb, 3, 2, 6, lut);
    expect([six.width, six.height]).toEqual([2, 3]);
    expect(values(six)).toEqual([3, 0, 4, 1, 5, 2]);
    const eight = developPixels(rgb, 3, 2, 8, lut);
    expect(values(eight)).toEqual([2, 5, 1, 4, 0, 3]);
    const three = developPixels(rgb, 3, 2, 3, lut);
    expect(values(three)).toEqual([5, 4, 3, 2, 1, 0]);
  });
});
