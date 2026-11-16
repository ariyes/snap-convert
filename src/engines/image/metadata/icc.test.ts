import { describe, expect, it } from 'vitest';
import { iccDescription, iccSegments, isSrgbProfile } from './icc';
import { MARKER, MAX_SEGMENT_PAYLOAD } from './jpeg-segments';
import { buildIcc } from './testing/builders';

describe('isSrgbProfile', () => {
  it.each([
    ['sRGB IEC61966-2.1', 2],
    ['sRGB built-in', 2],
    ['sRGB v4 ICC preference perceptual intent beta', 4],
  ] as const)('keeps "%s" (v%i)', (name, version) => {
    const icc = buildIcc(name, version);
    expect(iccDescription(icc)).toBe(name);
    expect(isSrgbProfile(icc)).toBe(true);
    expect(isSrgbProfile(icc.buffer)).toBe(true);
  });

  it.each([
    ['Display P3', 4, 'RGB '],
    ['Adobe RGB (1998)', 2, 'RGB '],
    ['ProPhoto RGB', 2, 'RGB '],
    ['sRGB-ish grey', 2, 'GRAY'],
  ] as const)('drops "%s"', (name, version, space) => {
    expect(isSrgbProfile(buildIcc(name, version, space))).toBe(false);
  });

  it('drops garbage and truncated profiles without throwing', () => {
    expect(isSrgbProfile(new Uint8Array(10))).toBe(false);
    expect(isSrgbProfile(buildIcc('sRGB IEC61966-2.1').subarray(0, 140))).toBe(false);
    const huge = buildIcc('sRGB IEC61966-2.1');
    new DataView(huge.buffer).setUint32(128, 0xffffffff); // absurd tag count
    expect(isSrgbProfile(huge)).toBe(false);
  });
});

describe('iccSegments', () => {
  it('fits a small profile in one APP2 segment numbered 1 of 1', () => {
    const [seg, ...rest] = iccSegments(buildIcc('sRGB IEC61966-2.1'));
    expect(rest).toHaveLength(0);
    expect(seg?.marker).toBe(MARKER.APP2);
    expect(String.fromCharCode(...seg!.data.subarray(0, 12))).toBe('ICC_PROFILE\0');
    expect([seg!.data[12], seg!.data[13]]).toEqual([1, 1]);
  });

  it('splits a large profile into numbered chunks that each fit a segment', () => {
    const big = new Uint8Array(150_000).map((_, i) => i & 0xff);
    const segs = iccSegments(big);
    expect(segs).toHaveLength(3);
    segs.forEach((s, i) => {
      expect(s.data.length).toBeLessThanOrEqual(MAX_SEGMENT_PAYLOAD);
      expect([s.data[12], s.data[13]]).toEqual([i + 1, 3]);
    });
    const joined = segs.flatMap((s) => Array.from(s.data.subarray(14)));
    expect(joined).toEqual(Array.from(big));
  });
});
