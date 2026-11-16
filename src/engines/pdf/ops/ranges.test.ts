import { describe, expect, it } from 'vitest';
import { parseRanges } from './ranges';

describe('parseRanges — valid input', () => {
  const cases: Array<[spec: string, pageCount: number, expected: number[][]]> = [
    ['1-3, 5, 8-10', 10, [[1, 2, 3], [5], [8, 9, 10]]],
    ['1-3,5,8-10', 10, [[1, 2, 3], [5], [8, 9, 10]]],
    ['  1 - 3 ,  5 ,8 -10  ', 10, [[1, 2, 3], [5], [8, 9, 10]]],
    ['1', 1, [[1]]],
    ['7', 10, [[7]]],
    ['10', 10, [[10]]],
    ['1-10', 10, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]],
    ['3-3', 10, [[3]]],
    ['5-', 7, [[5, 6, 7]]],
    ['5 -', 7, [[5, 6, 7]]],
    ['7-', 7, [[7]]],
    ['-3', 10, [[1, 2, 3]]],
    ['- 2', 10, [[1, 2]]],
    ['-1', 10, [[1]]],
    [
      '-3, 8-',
      10,
      [
        [1, 2, 3],
        [8, 9, 10],
      ],
    ],
    [
      '8-10, 1-2',
      10,
      [
        [8, 9, 10],
        [1, 2],
      ],
    ], // order kept as written
    [
      '1-3, 2-4',
      10,
      [
        [1, 2, 3],
        [2, 3, 4],
      ],
    ], // overlaps allowed
    ['5, 5', 10, [[5], [5]]],
    ['1-3,', 10, [[1, 2, 3]]], // trailing comma while typing
    [',1,,2,', 10, [[1], [2]]],
    ['01-03', 10, [[1, 2, 3]]],
    ['2–4', 10, [[2, 3, 4]]], // en dash
    ['2—4', 10, [[2, 3, 4]]], // em dash
    ['2−4', 10, [[2, 3, 4]]], // minus sign
    ['\t1-2\n', 5, [[1, 2]]],
  ];

  it.each(cases)('%j of %i pages', (spec, pageCount, expected) => {
    expect(parseRanges(spec, pageCount)).toEqual(expected);
  });
});

describe('parseRanges — errors shown to the user', () => {
  const cases: Array<[spec: string, pageCount: number, message: string]> = [
    // out of range
    ['12', 10, "Page 12 doesn't exist — this PDF has 10 pages"],
    ['1-12', 10, "Page 12 doesn't exist — this PDF has 10 pages"],
    ['11-', 10, "Page 11 doesn't exist — this PDF has 10 pages"],
    ['-11', 10, "Page 11 doesn't exist — this PDF has 10 pages"],
    ['2', 1, "Page 2 doesn't exist — this PDF has 1 page"],
    ['1, 3, 99', 3, "Page 99 doesn't exist — this PDF has 3 pages"],
    [
      '123456789012345678901234',
      5,
      "Page 123456789012345678901234 doesn't exist — this PDF has 5 pages",
    ],
    ['011', 10, "Page 11 doesn't exist — this PDF has 10 pages"],
    // reversed
    ['5-3', 10, '“5-3” is backwards — write it as 3-5'],
    ['1-3, 10-8', 10, '“10-8” is backwards — write it as 8-10'],
    // zero
    ['0', 10, 'Page numbers start at 1'],
    ['0-3', 10, 'Page numbers start at 1'],
    ['2-0', 10, 'Page numbers start at 1'],
    ['-0', 10, 'Page numbers start at 1'],
    ['00', 10, 'Page numbers start at 1'],
    // empty
    ['', 10, 'Enter the pages you want, like 1-3, 5, 8-10'],
    ['   ', 10, 'Enter the pages you want, like 1-3, 5, 8-10'],
    [', ,', 10, 'Enter the pages you want, like 1-3, 5, 8-10'],
    // junk
    ['abc', 10, "“abc” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['-', 10, "“-” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['1-2-3', 10, "“1-2-3” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['1.5', 10, "“1.5” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['+2', 10, "“+2” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['1 2', 10, "“1 2” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['1;3', 10, "“1;3” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['1-3, x', 10, "“x” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['1e2', 200, "“1e2” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['0x5', 10, "“0x5” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    ['five', 10, "“five” isn't a page or range — use numbers like 1-3, 5, 8-10"],
    // no pages at all
    ['1', 0, 'This PDF has no pages'],
  ];

  it.each(cases)('%j of %i pages', (spec, pageCount, message) => {
    expect(() => parseRanges(spec, pageCount)).toThrow(RangeError);
    expect(() => parseRanges(spec, pageCount)).toThrow(message);
  });

  it('reports the full message exactly', () => {
    try {
      parseRanges('1-3, 5, 12', 10);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect((error as RangeError).message).toBe("Page 12 doesn't exist — this PDF has 10 pages");
    }
  });
});
