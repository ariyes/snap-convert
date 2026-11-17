import { describe, expect, it } from 'vitest';
import { planSplit, rangesText, togglePage } from './plan';

describe('planSplit', () => {
  it('makes one part per page', () => {
    expect(planSplit('every-page', 2, '', 3)).toEqual({ ok: true, groups: [[1], [2], [3]] });
  });

  it('makes parts of N pages, the last one shorter', () => {
    expect(planSplit('every-n', 4, '', 10)).toEqual({
      ok: true,
      groups: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10],
      ],
    });
    expect(planSplit('every-n', 0, '', 10)).toEqual({
      ok: false,
      error: 'Enter how many pages each part should have (1 or more)',
    });
  });

  it('reads custom ranges', () => {
    expect(planSplit('ranges', 1, '1-3, 5, 8-10', 10)).toEqual({
      ok: true,
      groups: [[1, 2, 3], [5], [8, 9, 10]],
    });
  });

  it("returns parseRanges' message for invalid ranges", () => {
    expect(planSplit('ranges', 1, '3-1', 10)).toEqual({
      ok: false,
      error: '“3-1” is backwards — write it as 1-3',
    });
    expect(planSplit('ranges', 1, '1-12', 10)).toEqual({
      ok: false,
      error: "Page 12 doesn't exist — this PDF has 10 pages",
    });
    expect(planSplit('ranges', 1, '', 10)).toEqual({
      ok: false,
      error: 'Enter the pages you want, like 1-3, 5, 8-10',
    });
  });

  it('needs pages', () => {
    expect(planSplit('every-page', 1, '', 0).ok).toBe(false);
  });
});

describe('rangesText', () => {
  it('writes parts back as ranges', () => {
    expect(rangesText([[1, 2, 3], [5], [8, 9, 10]])).toBe('1-3, 5, 8-10');
  });
});

describe('togglePage', () => {
  it('starts from an empty field', () => {
    expect(togglePage('', 4, 10)).toBe('4');
  });

  it('extends the part just before or after the page', () => {
    expect(togglePage('1-3', 4, 10)).toBe('1-4');
    expect(togglePage('5-6', 4, 10)).toBe('4-6');
  });

  it('adds a lone page in page order', () => {
    expect(togglePage('1-3, 8-10', 5, 10)).toBe('1-3, 5, 8-10');
    expect(togglePage('5', 1, 10)).toBe('1, 5');
  });

  it('takes a page out, splitting its part when needed', () => {
    expect(togglePage('1-3, 5, 8-10', 5, 10)).toBe('1-3, 8-10');
    expect(togglePage('1-3', 1, 10)).toBe('2-3');
    expect(togglePage('1-5', 3, 10)).toBe('1-2, 4-5');
  });

  it('expands open ranges', () => {
    expect(togglePage('8-', 10, 10)).toBe('8-9');
  });

  it('starts again when the field is invalid', () => {
    expect(togglePage('abc', 2, 10)).toBe('2');
  });
});
