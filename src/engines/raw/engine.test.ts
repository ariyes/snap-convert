import { describe, expect, it } from 'vitest';
import { failureFor, isoDate, isOutOfMemory } from './engine';

class FakeFlashRawError extends Error {
  constructor(
    readonly kind: string,
    message = kind,
  ) {
    super(message);
  }
}

describe('failureFor', () => {
  it('names the format of files no decoder supports', () => {
    expect(
      failureFor(new FakeFlashRawError('UnsupportedCompression'), {
        detected: 'X3F',
        extension: 'X3F',
        make: 'Sigma',
      }),
    ).toMatchObject({ kind: 'unsupported', format: 'Sigma X3F' });
    expect(
      failureFor(new FakeFlashRawError('CameraUnsupported'), { detected: 'NEF', extension: 'NEF' }),
    ).toMatchObject({ kind: 'unsupported', format: 'NEF' });
  });

  it('calls a known format that nothing can read damaged, an unknown one unsupported', () => {
    expect(
      failureFor(new FakeFlashRawError('UnsupportedFormat'), { extension: 'NEF' }),
    ).toMatchObject({
      kind: 'damaged',
    });
    expect(
      failureFor(new FakeFlashRawError('UnsupportedFormat'), { extension: 'XYZ' }),
    ).toMatchObject({
      kind: 'unsupported',
      format: 'XYZ',
    });
    expect(
      failureFor(new FakeFlashRawError('CorruptFile'), { detected: 'CR3', extension: 'CR3' }),
    ).toMatchObject({
      kind: 'damaged',
    });
  });

  it('reports running out of memory', () => {
    expect(failureFor(new FakeFlashRawError('OutOfMemory'), { extension: 'ARW' }).kind).toBe(
      'out-of-memory',
    );
    expect(
      failureFor(new RangeError('Array buffer allocation failed'), { extension: 'ARW' }).kind,
    ).toBe('out-of-memory');
  });
});

describe('isOutOfMemory', () => {
  it('recognises allocation failures and WebAssembly traps, nothing else', () => {
    expect(isOutOfMemory(new FakeFlashRawError('LimitExceeded'))).toBe(true);
    expect(isOutOfMemory(new FakeFlashRawError('Internal', 'unreachable executed'))).toBe(true);
    expect(isOutOfMemory(new WebAssembly.RuntimeError('memory access out of bounds'))).toBe(true);
    expect(isOutOfMemory(new FakeFlashRawError('Internal', 'index out of range'))).toBe(false);
    expect(isOutOfMemory(new RangeError('Invalid array length'))).toBe(false);
    expect(isOutOfMemory(new Error('nope'))).toBe(false);
  });
});

describe('isoDate', () => {
  it('drops fractional seconds and keeps the offset', () => {
    expect(isoDate('2021-05-10T20:11:06.29+00:00')).toBe('2021-05-10T20:11:06+00:00');
    expect(isoDate('2018-04-15T10:40:32')).toBe('2018-04-15T10:40:32');
    expect(isoDate('2022-09-10T11:32:07.052466+02:00')).toBe('2022-09-10T11:32:07+02:00');
    expect(isoDate(null)).toBeUndefined();
    expect(isoDate('garbage')).toBeUndefined();
  });
});
