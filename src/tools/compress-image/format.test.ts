import { describe, expect, it } from 'vitest';
import { compressedName, downloadNames, formatBytes, savedPercent, savedText } from './format';

describe('formatBytes', () => {
  it('formats like the prototype', () => {
    expect(formatBytes(830)).toBe('830 B');
    expect(formatBytes(9_600)).toBe('9.4 KB');
    expect(formatBytes(158_903)).toBe('155 KB');
    expect(formatBytes(2_183_168)).toBe('2.1 MB');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('saved', () => {
  it('is a whole percentage, positive when smaller', () => {
    expect(savedPercent(1000, 660)).toBe(34);
    expect(savedPercent(1000, 1170)).toBe(-17);
    expect(savedPercent(1000, 999)).toBe(0);
    expect(savedPercent(0, 10)).toBe(0);
  });

  it('reads "−34%", "+17%" or "None"', () => {
    expect(savedText(1000, 660)).toBe('−34%');
    expect(savedText(1000, 1170)).toBe('+17%');
    expect(savedText(1000, 1000)).toBe('None');
  });
});

describe('file names', () => {
  it('is <name>-compressed.<ext> with the saved format', () => {
    expect(compressedName('IMG_2041.jpg', 'jpeg')).toBe('IMG_2041-compressed.jpg');
    expect(compressedName('IMG_1.HEIC', 'jpeg')).toBe('IMG_1-compressed.jpg');
    expect(compressedName('logo.final.png', 'webp')).toBe('logo.final-compressed.webp');
    expect(compressedName('noext', 'avif')).toBe('noext-compressed.avif');
  });

  it('makes names safe', () => {
    expect(compressedName('a:b*c.jpg', 'jpeg')).toBe('abc-compressed.jpg');
  });

  it('makes names unique', () => {
    expect(
      downloadNames([
        { sourceName: 'a.jpg', result: { format: 'jpeg' } },
        { sourceName: 'a.png', result: { format: 'jpeg' } },
        { sourceName: 'b.jpg', result: { format: 'jpeg' } },
      ]),
    ).toEqual(['a-compressed.jpg', 'a-compressed (2).jpg', 'b-compressed.jpg']);
  });
});
