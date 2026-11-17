import { describe, expect, it } from 'vitest';
import {
  developBytes,
  fullSizePreview,
  memoryBudget,
  normalizeRawOptions,
  planRaw,
  RAW_MEMORY,
  type PlanInput,
} from './plan';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const M50 = { width: 6000, height: 4000 };
const M50_PREVIEWS = [
  { index: 0, width: 160, height: 120, encoding: 'jpeg' },
  { index: 1, width: 1620, height: 1080, encoding: 'jpeg' },
  { index: 2, width: 6000, height: 4000, encoding: 'jpeg' },
];
const base: PlanInput = {
  mode: 'fast',
  image: M50,
  previews: M50_PREVIEWS,
  fileBytes: 15e6,
  budget: RAW_MEMORY.desktopBudget,
};

describe('memoryBudget', () => {
  it('treats iPhones, iPads (Mac user agent with touch) and Android phones as phones', () => {
    expect(memoryBudget({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(RAW_MEMORY.phoneBudget);
    expect(memoryBudget({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(
      RAW_MEMORY.phoneBudget,
    );
    expect(memoryBudget({ userAgent: ANDROID, maxTouchPoints: 5, deviceMemory: 8 })).toBe(
      RAW_MEMORY.phoneBudget,
    );
  });

  it('gives a Mac or PC the desktop budget, less with ≤ 4 GB', () => {
    expect(memoryBudget({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(
      RAW_MEMORY.desktopBudget,
    );
    expect(memoryBudget({ userAgent: DESKTOP, maxTouchPoints: 0, deviceMemory: 8 })).toBe(
      RAW_MEMORY.desktopBudget,
    );
    expect(memoryBudget({ userAgent: DESKTOP, maxTouchPoints: 0, deviceMemory: 4 })).toBe(
      RAW_MEMORY.lowMemoryBudget,
    );
  });
});

describe('fullSizePreview', () => {
  it('picks the largest JPEG when its long side is at least 90 % of the image', () => {
    expect(fullSizePreview(M50, M50_PREVIEWS)).toEqual({ index: 2, width: 6000, height: 4000 });
    expect(
      fullSizePreview(M50, [{ index: 0, width: 5400, height: 3600, encoding: 'jpeg' }]),
    ).toBeDefined();
  });

  it('ignores small JPEGs and non-JPEG previews (HEIF on HDR Canons)', () => {
    expect(
      fullSizePreview(M50, [{ index: 0, width: 1616, height: 1080, encoding: 'jpeg' }]),
    ).toBeUndefined();
    expect(
      fullSizePreview(M50, [{ index: 0, width: 6000, height: 4000, encoding: 'heif' }]),
    ).toBeUndefined();
    expect(fullSizePreview(M50, [])).toBeUndefined();
  });
});

describe('planRaw', () => {
  it('fast mode uses the camera JPEG when it is full size', () => {
    expect(planRaw(base)).toEqual({
      use: 'preview',
      preview: { index: 2, width: 6000, height: 4000 },
    });
  });

  it('full mode always develops; fast mode develops when there is no full-size JPEG', () => {
    expect(planRaw({ ...base, mode: 'full' })).toEqual({ use: 'develop', halfSize: false });
    expect(planRaw({ ...base, previews: M50_PREVIEWS.slice(0, 2) })).toEqual({
      use: 'develop',
      halfSize: false,
    });
  });

  it('develops at half size when a full develop would not fit this device', () => {
    const phone = { ...base, mode: 'full' as const, budget: RAW_MEMORY.phoneBudget };
    expect(developBytes(6000, 4000, 15e6, false)).toBeGreaterThan(RAW_MEMORY.phoneBudget);
    expect(planRaw(phone)).toEqual({ use: 'develop', halfSize: true, reason: 'memory' });
    // 12 MP fits a phone in full
    expect(planRaw({ ...phone, image: { width: 4272, height: 2848 } })).toEqual({
      use: 'develop',
      halfSize: false,
    });
    // the camera JPEG is still preferred in fast mode
    expect(planRaw({ ...phone, mode: 'fast' }).use).toBe('preview');
  });

  it('develops at half size for small outputs (≥ 2× the output kept), as a reduced decode', () => {
    expect(planRaw({ ...base, mode: 'full', minLongestSide: 1500 })).toEqual({
      use: 'develop',
      halfSize: true,
      reason: 'hint',
    });
    expect(planRaw({ ...base, mode: 'full', minLongestSide: 1501 })).toEqual({
      use: 'develop',
      halfSize: false,
    });
  });

  it('forceHalf after an out-of-memory failure', () => {
    expect(planRaw({ ...base, mode: 'full', forceHalf: true })).toEqual({
      use: 'develop',
      halfSize: true,
      reason: 'memory',
    });
  });
});

describe('normalizeRawOptions', () => {
  it('defaults to fast, as shot, 0 EV, clip and keeps exposure within ±2', () => {
    expect(normalizeRawOptions(undefined)).toEqual({
      mode: 'fast',
      whiteBalance: 'as-shot',
      exposure: 0,
      highlights: 'clip',
    });
    expect(normalizeRawOptions({ mode: 'full', exposure: 5 }).exposure).toBe(2);
    expect(normalizeRawOptions({ exposure: -9 }).exposure).toBe(-2);
    expect(normalizeRawOptions({ exposure: Number.NaN }).exposure).toBe(0);
    expect(normalizeRawOptions({ whiteBalance: 'auto', highlights: 'recover' })).toMatchObject({
      whiteBalance: 'auto',
      highlights: 'recover',
    });
  });
});
