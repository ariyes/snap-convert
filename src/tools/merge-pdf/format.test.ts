import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [412, '412 B'],
    [1536, '1.5 KB'],
    [38_000, '37 KB'],
    [10_171_187, '9.7 MB'],
    [3 * 1024 ** 3, '3.0 GB'],
    [-1, '0 B'],
  ])('%d → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
