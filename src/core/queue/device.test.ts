import { describe, expect, it } from 'vitest';
import {
  computePoolSize,
  HEAVY_LIMITS,
  inputBytes,
  inputMegapixels,
  isHeavyInput,
  isPhoneLike,
  readDevice,
  type DeviceInfo,
} from './device';

const desktop = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  cores: 8,
  coarsePointer: false,
  viewportWidth: 1440,
  deviceMemory: 8,
  ...over,
});

describe('computePoolSize', () => {
  it('uses the core count, at most 8', () => {
    expect(computePoolSize(desktop({ cores: 4 }))).toBe(4);
    expect(computePoolSize(desktop({ cores: 8 }))).toBe(8);
    expect(computePoolSize(desktop({ cores: 32 }))).toBe(8);
  });

  it('falls back to 2 when the core count is unknown', () => {
    expect(computePoolSize(desktop({ cores: undefined }))).toBe(2);
    expect(computePoolSize(desktop({ cores: 0 }))).toBe(2);
  });

  it('caps phones at 2: coarse pointer and narrow screen', () => {
    expect(computePoolSize(desktop({ cores: 8, coarsePointer: true, viewportWidth: 390 }))).toBe(2);
    expect(computePoolSize(desktop({ cores: 8, coarsePointer: true, viewportWidth: 879 }))).toBe(2);
  });

  it('caps low-memory devices at 2', () => {
    expect(computePoolSize(desktop({ cores: 8, deviceMemory: 4 }))).toBe(2);
    expect(computePoolSize(desktop({ cores: 8, deviceMemory: 2 }))).toBe(2);
  });

  it('does not cap a tablet-width touch screen with plenty of memory, or a narrow desktop window', () => {
    expect(computePoolSize(desktop({ cores: 8, coarsePointer: true, viewportWidth: 1024 }))).toBe(8);
    expect(computePoolSize(desktop({ cores: 8, coarsePointer: false, viewportWidth: 500 }))).toBe(8);
  });

  it('never goes below 1', () => {
    expect(computePoolSize(desktop({ cores: 1, coarsePointer: true, viewportWidth: 300 }))).toBe(1);
  });

  it('isPhoneLike matches the rule', () => {
    expect(isPhoneLike(desktop())).toBe(false);
    expect(isPhoneLike(desktop({ coarsePointer: true, viewportWidth: 400 }))).toBe(true);
    expect(isPhoneLike(desktop({ deviceMemory: undefined }))).toBe(false);
  });

  it('readDevice returns something usable', () => {
    const d = readDevice();
    expect(computePoolSize(d)).toBeGreaterThanOrEqual(1);
    expect(computePoolSize(d)).toBeLessThanOrEqual(8);
  });
});

describe('heavy jobs', () => {
  it('reads megapixels from width and height on the input', () => {
    expect(inputMegapixels({ width: 4000, height: 3000 })).toBe(12);
    expect(inputMegapixels({ width: 4000 })).toBeNull();
    expect(inputMegapixels({ width: Number.NaN, height: 10 })).toBeNull();
    expect(inputMegapixels('x')).toBeNull();
  });

  it('adds up blobs and buffers anywhere in the input', () => {
    const a = new Blob([new Uint8Array(1000)]);
    const b = new Blob([new Uint8Array(500)]);
    expect(inputBytes(a)).toBe(1000);
    expect(inputBytes({ file: a, name: 'x' })).toBe(1000);
    expect(inputBytes({ files: [{ blob: a, name: 'a' }, { blob: b, name: 'b' }] })).toBe(1500);
    expect(inputBytes({ data: new ArrayBuffer(64), view: new Uint8Array(32) })).toBe(96);
    expect(inputBytes(null)).toBe(0);
  });

  it('is heavy over 40 MP or over 100 MB', () => {
    expect(HEAVY_LIMITS).toEqual({ megapixels: 40, bytes: 100 * 1024 * 1024 });
    expect(isHeavyInput({ width: 8000, height: 5000 })).toBe(false); // exactly 40 MP
    expect(isHeavyInput({ width: 8000, height: 5001 })).toBe(true);
    expect(isHeavyInput({ file: new Blob([new Uint8Array(10)]) })).toBe(false);
    const small = { megapixels: 40, bytes: 1000 };
    expect(isHeavyInput({ file: new Blob([new Uint8Array(1000)]) }, small)).toBe(false);
    expect(isHeavyInput({ file: new Blob([new Uint8Array(1001)]) }, small)).toBe(true);
  });
});
