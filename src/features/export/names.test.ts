import { describe, expect, it } from 'vitest';
import type { NamePatternContext } from '@/core/contracts/export';
import {
  applyNamePattern,
  MAX_NAME_BYTES,
  MAX_NAME_CHARS,
  removeUnsafeChars,
  safeFileName,
  splitExtension,
  uniqueNames,
} from './names';

const ctx: NamePatternContext = { name: 'photo', width: 1200, height: 800, n: 3, format: 'webp' };
const long = 'a'.repeat(400);

describe('applyNamePattern', () => {
  // [pattern, context overrides, expected]
  const cases: Array<[string, Partial<NamePatternContext>, string]> = [
    // Tokens
    ['{name}', {}, 'photo'],
    ['{name}-{width}x{height}', {}, 'photo-1200x800'],
    ['{name}_{n}', {}, 'photo_3'],
    ['{format}', {}, 'webp'],
    ['{n}-{name}-{format}', {}, '3-photo-webp'],
    ['{NAME}-{Width}', {}, 'photo-1200'],
    ['{name}{name}', {}, 'photophoto'],
    ['web-{width}', { width: 1199.6 }, 'web-1200'],
    ['{name}-{width}x{height}', { width: undefined, height: undefined }, 'photo-x'],
    ['{name}-{width}', { width: Number.NaN }, 'photo-'],
    ['image {n}', { n: 0 }, 'image 0'],
    // Unknown tokens stay as typed
    ['{name}-{date}', {}, 'photo-{date}'],
    ['{size}', {}, '{size}'],
    ['{ name }', {}, '{ name }'],
    ['{{name}}', {}, '{photo}'],
    ['{name', {}, '{name'],
    // Inserted values are not expanded again
    ['{name}', { name: 'my {n} file' }, 'my {n} file'],
    ['{name}', { name: '{width}' }, '{width}'],
    // Every unsafe character is removed
    ['a/b', {}, 'ab'],
    ['a\\b', {}, 'ab'],
    ['a:b', {}, 'ab'],
    ['a*b', {}, 'ab'],
    ['a?b', {}, 'ab'],
    ['a"b', {}, 'ab'],
    ['a<b', {}, 'ab'],
    ['a>b', {}, 'ab'],
    ['a|b', {}, 'ab'],
    ['/\\:*?"<>|ok', {}, 'ok'],
    ['{name}', { name: '../../etc/passwd' }, 'etcpasswd'],
    ['{name}', { name: 'C:\\Windows\\System32\\x' }, 'CWindowsSystem32x'],
    // Control, bidi and other invisible characters are removed
    ['a\u0000b', {}, 'ab'],
    ['a\u0001b\u001Fc', {}, 'abc'],
    ['a\tb\nc\rd', {}, 'abcd'],
    ['a\u007Fb', {}, 'ab'],
    ['a\u0085b\u009Fc', {}, 'abc'],
    ['photo\u202Egpj.exe', {}, 'photogpj.exe'],
    ['a\u200E\u200F\u061C\u2066\u2069b', {}, 'ab'],
    ['\uFEFFname\u2028\u2029', {}, 'name'],
    ['a\uD800b', {}, 'ab'],
    ['a\uDC00b', {}, 'ab'],
    // Dots and spaces trimmed from both ends
    ['  photo  ', {}, 'photo'],
    ['...photo...', {}, 'photo'],
    ['. .photo. .', {}, 'photo'],
    ['.hidden', {}, 'hidden'],
    ['my photo.final', {}, 'my photo.final'],
    // Reserved Windows names (any case, any extension-like suffix)
    ['CON', {}, 'CON_'],
    ['con', {}, 'con_'],
    ['PRN', {}, 'PRN_'],
    ['AUX', {}, 'AUX_'],
    ['NUL', {}, 'NUL_'],
    ['nul.tar', {}, 'nul_.tar'],
    ['COM1', {}, 'COM1_'],
    ['com9', {}, 'com9_'],
    ['LPT1', {}, 'LPT1_'],
    ['lpt9', {}, 'lpt9_'],
    ['COM0', {}, 'COM0_'],
    ['COM\u00B9', {}, 'COM\u00B9_'],
    ['CONIN$', {}, 'CONIN$_'],
    ['{name}', { name: 'aux' }, 'aux_'],
    ['  CON  ', {}, 'CON_'],
    // Similar but allowed names are left alone
    ['CONSOLE', {}, 'CONSOLE'],
    ['COM10', {}, 'COM10'],
    ['LPT', {}, 'LPT'],
    ['icon', {}, 'icon'],
    // Empty results fall back to "image"
    ['', {}, 'image'],
    ['   ', {}, 'image'],
    ['...', {}, 'image'],
    ['..', {}, 'image'],
    ['/\\', {}, 'image'],
    ['\u0000\u0001', {}, 'image'],
    ['{name}', { name: '' }, 'image'],
    ['{width}', { width: undefined }, 'image'],
    ['{name}', { name: '\u202E' }, 'image'],
    // Unicode is kept (and normalised to NFC)
    ['café', {}, 'café'],
    ['cafe\u0301', {}, 'caf\u00E9'],
    ['写真 {n}', {}, '写真 3'],
    ['{name}', { name: 'фото' }, 'фото'],
    ['party 🎉', {}, 'party 🎉'],
    ['a + b = c & (d) [e] #f', {}, 'a + b = c & (d) [e] #f'],
    // Length limit
    [long, {}, 'a'.repeat(MAX_NAME_CHARS)],
    ['{name}', { name: long }, 'a'.repeat(MAX_NAME_CHARS)],
    [`${'a'.repeat(149)}.  b`, {}, `${'a'.repeat(149)}`],
  ];

  it('has at least 40 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it.each(cases)('%j with %j → %j', (pattern, overrides, expected) => {
    expect(applyNamePattern(pattern, { ...ctx, ...overrides })).toBe(expected);
  });

  it('never adds an extension', () => {
    expect(applyNamePattern('{name}', { ...ctx, name: 'photo' })).not.toMatch(/\.webp$/);
  });

  it('never splits an emoji or accented letter when shortening', () => {
    const family = '👨‍👩‍👧‍👦'; // 11 UTF-16 units, 25 UTF-8 bytes
    const out = applyNamePattern(family.repeat(30), ctx);
    expect(out.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
    expect(out.length % family.length).toBe(0);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(out).toBe(family.repeat(out.length / family.length));
  });

  it('limits multi-byte names by UTF-8 bytes', () => {
    const out = applyNamePattern('写'.repeat(150), ctx); // 3 bytes each
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(out).toBe('写'.repeat(Math.floor(MAX_NAME_BYTES / 3)));
  });

  it('never returns an unsafe name for random input', () => {
    // Deterministic pseudo-random strings over a nasty alphabet.
    const alphabet = [
      '/',
      '\\',
      ':',
      '*',
      '?',
      '"',
      '<',
      '>',
      '|',
      '.',
      ' ',
      '\u0000',
      '\u202E',
      'a',
      'C',
      'O',
      'N',
      '\uD83D',
      '\uDE00',
      'é',
    ];
    let seed = 42;
    const rand = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 2000; i += 1) {
      const len = Math.floor(rand() * 12);
      const raw = Array.from(
        { length: len },
        () => alphabet[Math.floor(rand() * alphabet.length)],
      ).join('');
      const out = applyNamePattern(raw, ctx);
      expect(out).not.toBe('');
      expect(out).not.toMatch(/[/\\:*?"<>|]/);
      expect(
        Array.from(out, (c) => c.codePointAt(0) ?? 0).some((cp) => cp < 0x20 || cp === 0x202e),
      ).toBe(false);
      expect(removeUnsafeChars(out)).toBe(out); // also proves there are no lone surrogates
      expect(out).not.toMatch(/^[\s.]|[\s.]$/);
      expect(out.split('.')[0]?.trimEnd().toUpperCase()).not.toMatch(
        /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/,
      );
    }
  });
});

describe('safeFileName', () => {
  it.each([
    ['photo.jpg', 'photo.jpg'],
    ['../../evil.jpg', 'evil.jpg'],
    ['a/b\\c.png', 'abc.png'],
    ['con.jpg', 'con_.jpg'],
    ['NUL.tar.gz', 'NUL_.tar.gz'],
    ['.jpg', 'jpg'],
    ['..jpg', 'image.jpg'],
    ['photo.', 'photo'],
    ['photo. jpg', 'photo.jpg'],
    ['photo.j\u202Epg', 'photo.jpg'],
    ['photo.jp*g', 'photo.jpg'],
    ['photo.exe .jpg', 'photo.exe.jpg'],
    ['', 'image'],
    ['report', 'report'],
    [`${long}.pdf`, `${'a'.repeat(MAX_NAME_CHARS)}.pdf`],
    ['photo.verylongextensionname', 'photo.verylongex'],
  ])('%j → %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });
});

describe('splitExtension', () => {
  it.each([
    ['a.jpg', ['a', '.jpg']],
    ['a.tar.gz', ['a.tar', '.gz']],
    ['README', ['README', '']],
    ['.env', ['.env', '']],
    ['a.', ['a.', '']],
  ] as const)('%j', (input, expected) => {
    expect(splitExtension(input)).toEqual(expected);
  });
});

describe('uniqueNames', () => {
  it('matches the contract example', () => {
    expect(uniqueNames(['a.jpg', 'a.jpg'])).toEqual(['a.jpg', 'a (2).jpg']);
  });

  it('ignores letter case', () => {
    expect(uniqueNames(['Photo.JPG', 'photo.jpg', 'PHOTO.jpg'])).toEqual([
      'Photo.JPG',
      'photo (2).jpg',
      'PHOTO (3).jpg',
    ]);
  });

  it('treats NFC and NFD forms as the same name', () => {
    expect(uniqueNames(['caf\u00E9.jpg', 'cafe\u0301.jpg'])).toEqual([
      'caf\u00E9.jpg',
      'cafe\u0301 (2).jpg',
    ]);
  });

  it('leaves unique names alone and keeps order', () => {
    const names = ['b.png', 'a.png', 'c.webp', 'a.webp'];
    expect(uniqueNames(names)).toEqual(names);
  });

  it('handles names without an extension', () => {
    expect(uniqueNames(['report', 'report', 'report'])).toEqual([
      'report',
      'report (2)',
      'report (3)',
    ]);
  });

  it('only numbers the last extension', () => {
    expect(uniqueNames(['a.tar.gz', 'a.tar.gz'])).toEqual(['a.tar.gz', 'a.tar (2).gz']);
  });

  it('never collides with a name that is already in the list', () => {
    const out = uniqueNames(['a.jpg', 'a.jpg', 'a (2).jpg', 'A (3).jpg', 'a.jpg']);
    expect(out).toEqual(['a.jpg', 'a (4).jpg', 'a (2).jpg', 'A (3).jpg', 'a (5).jpg']);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(out.length);
  });

  it('handles 1,000 identical names', () => {
    const out = uniqueNames(Array.from({ length: 1000 }, () => 'image.jpg'));
    expect(out).toHaveLength(1000);
    expect(out[0]).toBe('image.jpg');
    expect(out[1]).toBe('image (2).jpg');
    expect(out[999]).toBe('image (1000).jpg');
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(1000);
    out.slice(1).forEach((name, i) => expect(name).toBe(`image (${i + 2}).jpg`));
  });

  it('handles 1,000 identical names in mixed case quickly', () => {
    const input = Array.from({ length: 1000 }, (_, i) => (i % 2 ? 'IMAGE.JPG' : 'image.jpg'));
    const start = performance.now();
    const out = uniqueNames(input);
    expect(performance.now() - start).toBeLessThan(200);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(1000);
  });

  it('returns an empty list for no names', () => {
    expect(uniqueNames([])).toEqual([]);
  });
});
