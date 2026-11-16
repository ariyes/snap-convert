import { describe as group, expect, it } from 'vitest';
import type { Anchor, ExactOptions, ResizeOptions, Size } from '@/core/contracts/sizing';
import { aspectRatio, describe, exactPlacement, fitSize } from './index';

const size = (width: number, height: number): Size => ({ width, height });
/** Lets a test pass values the types forbid, to check runtime validation. */
const loose = <T>(value: unknown): T => value as T;

group('fitSize — acceptance cases', () => {
  it('2000×1500: longest 1000 → 1000×750, width 1000 → 1000×750, height 1000 → 1333×1000', () => {
    const src = size(2000, 1500);
    expect(fitSize(src, { mode: 'longest', value: 1000 })).toMatchObject({
      width: 1000,
      height: 750,
    });
    expect(fitSize(src, { mode: 'width', value: 1000 })).toMatchObject({
      width: 1000,
      height: 750,
    });
    expect(fitSize(src, { mode: 'height', value: 1000 })).toMatchObject({
      width: 1333,
      height: 1000,
    });
  });

  it('800×600, longest 1920 → unchanged, not enlarged; with upscale → 1920×1440', () => {
    const src = size(800, 600);
    expect(fitSize(src, { mode: 'longest', value: 1920 })).toEqual({
      width: 800,
      height: 600,
      scale: 1,
      enlarged: false,
      unchanged: true,
    });
    expect(fitSize(src, { mode: 'longest', value: 1920, upscale: true })).toEqual({
      width: 1920,
      height: 1440,
      scale: 2.4,
      enlarged: true,
      unchanged: false,
    });
  });

  it('3024×4032 portrait, longest 1920 → 1440×1920', () => {
    expect(fitSize(size(3024, 4032), { mode: 'longest', value: 1920 })).toEqual({
      width: 1440,
      height: 1920,
      scale: 1920 / 4032,
      enlarged: false,
      unchanged: false,
    });
  });

  it('extreme ratios never produce a 0-pixel side', () => {
    expect(fitSize(size(1, 10000), { mode: 'longest', value: 100 })).toMatchObject({
      width: 1,
      height: 100,
    });
    expect(fitSize(size(10000, 1), { mode: 'longest', value: 100 })).toMatchObject({
      width: 100,
      height: 1,
    });
    expect(fitSize(size(10000, 1), { mode: 'height', value: 1 })).toMatchObject({
      width: 10000,
      height: 1,
      unchanged: true,
    });
    expect(fitSize(size(1, 10000), { mode: 'percent', value: 1 })).toMatchObject({
      width: 1,
      height: 100,
    });
    expect(fitSize(size(1, 1), { mode: 'longest', value: 1 })).toMatchObject({
      width: 1,
      height: 1,
      unchanged: true,
    });
  });
});

group('fitSize — modes', () => {
  it('width / height limits only one side', () => {
    expect(fitSize(size(1000, 4000), { mode: 'width', value: 500 })).toMatchObject({
      width: 500,
      height: 2000,
    });
    expect(fitSize(size(4000, 1000), { mode: 'height', value: 500 })).toMatchObject({
      width: 2000,
      height: 500,
    });
  });

  it('never enlarges with width / height / longest unless upscale is on', () => {
    for (const mode of ['width', 'height', 'longest'] as const) {
      expect(fitSize(size(640, 480), { mode, value: 5000 })).toMatchObject({
        width: 640,
        height: 480,
        enlarged: false,
        unchanged: true,
      });
    }
    expect(fitSize(size(640, 480), { mode: 'height', value: 960, upscale: true })).toMatchObject({
      width: 1280,
      height: 960,
      scale: 2,
      enlarged: true,
    });
    expect(fitSize(size(640, 480), { mode: 'width', value: 960, upscale: false })).toMatchObject({
      width: 640,
      height: 480,
    });
  });

  it('a limit equal to the size is unchanged, with or without upscale', () => {
    for (const upscale of [false, true]) {
      expect(fitSize(size(1920, 1080), { mode: 'longest', value: 1920, upscale })).toEqual({
        width: 1920,
        height: 1080,
        scale: 1,
        enlarged: false,
        unchanged: true,
      });
    }
  });

  it('percent scales by value / 100, capped at 100% unless upscale', () => {
    expect(fitSize(size(2000, 1500), { mode: 'percent', value: 50 })).toEqual({
      width: 1000,
      height: 750,
      scale: 0.5,
      enlarged: false,
      unchanged: false,
    });
    expect(fitSize(size(2000, 1500), { mode: 'percent', value: 150 })).toMatchObject({
      width: 2000,
      height: 1500,
      scale: 1,
      unchanged: true,
    });
    expect(fitSize(size(2000, 1500), { mode: 'percent', value: 150, upscale: true })).toEqual({
      width: 3000,
      height: 2250,
      scale: 1.5,
      enlarged: true,
      unchanged: false,
    });
    expect(fitSize(size(1000, 1000), { mode: 'percent', value: 33.3 })).toMatchObject({
      width: 333,
      height: 333,
    });
  });

  it('none keeps the size and ignores value and upscale', () => {
    for (const value of [0, -1, NaN, 5000]) {
      expect(fitSize(size(1234, 567), { mode: 'none', value, upscale: true })).toEqual({
        width: 1234,
        height: 567,
        scale: 1,
        enlarged: false,
        unchanged: true,
      });
    }
  });
});

group('fitSize — rounding', () => {
  it('rounds exact halves up (6×3, width 5 → 5×3; 1005×1001 at 50% → 503×501)', () => {
    expect(fitSize(size(6, 3), { mode: 'width', value: 5 })).toMatchObject({ width: 5, height: 3 });
    expect(fitSize(size(1005, 1001), { mode: 'percent', value: 50 })).toMatchObject({
      width: 503,
      height: 501,
    });
    // 11 × 15 / 22 = 7.5 exactly, but 11 × (15 / 22) in floating point is 7.4999… — a naive
    // `round(h × scale)` would give 7. The scale is applied as one exact fraction instead.
    expect(fitSize(size(22, 11), { mode: 'width', value: 15 })).toMatchObject({
      width: 15,
      height: 8,
    });
    expect(fitSize(size(46, 23), { mode: 'longest', value: 13 })).toMatchObject({
      width: 13,
      height: 7,
    });
  });

  it('rounds to nearest otherwise (4032×3024, longest 1000 → 1000×750; 3000×2000, width 1000 → 1000×667)', () => {
    expect(fitSize(size(4032, 3024), { mode: 'longest', value: 1000 })).toMatchObject({
      width: 1000,
      height: 750,
    });
    expect(fitSize(size(3000, 2000), { mode: 'width', value: 1000 })).toMatchObject({
      width: 1000,
      height: 667,
    });
  });

  it('a fractional limit is rounded down so the output never exceeds it', () => {
    expect(fitSize(size(2000, 1500), { mode: 'longest', value: 1000.9 })).toMatchObject({
      width: 1000,
      height: 750,
    });
    // A limit below 1 px still gives at least 1 px.
    expect(fitSize(size(2000, 1500), { mode: 'width', value: 0.4 })).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it('fractional source sizes (PDF points) give whole-pixel output', () => {
    const a4 = size(595.28, 841.89);
    expect(fitSize(a4, { mode: 'none', value: 0 })).toMatchObject({
      width: 595,
      height: 842,
      unchanged: false,
    });
    expect(fitSize(a4, { mode: 'longest', value: 421 })).toMatchObject({ width: 298, height: 421 });
  });
});

group('fitSize — invalid input throws RangeError', () => {
  const bad = [0, -1, NaN, Infinity, -Infinity, loose<number>('100'), loose<number>(undefined)];

  it.each(bad)('source width %s', (value) => {
    expect(() => fitSize(size(value, 100), { mode: 'longest', value: 10 })).toThrow(
      /Source width must be a finite number greater than 0/,
    );
  });

  it.each(bad)('source height %s', (value) => {
    expect(() => fitSize(size(100, value), { mode: 'none', value: 10 })).toThrow(
      /Source height must be a finite number greater than 0/,
    );
  });

  it.each(bad)('limit or percentage %s', (value) => {
    for (const mode of ['longest', 'width', 'height'] as const) {
      expect(() => fitSize(size(100, 100), { mode, value })).toThrow(RangeError);
      expect(() => fitSize(size(100, 100), { mode, value })).toThrow(/Size limit/);
    }
    expect(() => fitSize(size(100, 100), { mode: 'percent', value })).toThrow(/Percentage/);
  });

  it('unknown mode', () => {
    const o = loose<ResizeOptions>({ mode: 'stretch', value: 100 });
    expect(() => fitSize(size(100, 100), o)).toThrow(RangeError);
    expect(() => fitSize(size(100, 100), o)).toThrow(
      /Resize mode must be one of .* \(got "stretch"\)/,
    );
  });

  it('error messages name the bad value', () => {
    expect(() => fitSize(size(NaN, 1), { mode: 'none', value: 1 })).toThrow('(got NaN)');
    expect(() => fitSize(size(1, 1), { mode: 'width', value: loose<number>('9') })).toThrow(
      '(got "9")',
    );
  });
});

group('exactPlacement — acceptance cases', () => {
  it('9000×2600, exact 1080×1080 fit → canvas 1080×1080, target 1080×312, padded', () => {
    expect(exactPlacement(size(9000, 2600), { width: 1080, height: 1080, fit: 'fit' })).toEqual({
      canvas: { width: 1080, height: 1080 },
      source: { x: 0, y: 0, width: 9000, height: 2600 },
      target: { x: 0, y: 384, width: 1080, height: 312 },
      padded: true,
      cropped: false,
      enlarged: false,
    });
  });

  it('9000×2600, exact 1080×1080 fill → source crop width 2600 centred, cropped', () => {
    expect(exactPlacement(size(9000, 2600), { width: 1080, height: 1080, fit: 'fill' })).toEqual({
      canvas: { width: 1080, height: 1080 },
      source: { x: 3200, y: 0, width: 2600, height: 2600 },
      target: { x: 0, y: 0, width: 1080, height: 1080 },
      padded: false,
      cropped: true,
      enlarged: false,
    });
  });

  it('1×10000 and 10000×1 never produce a 0-pixel side', () => {
    const box = { width: 1080, height: 1080 };
    expect(exactPlacement(size(1, 10000), { ...box, fit: 'fit' })).toMatchObject({
      source: { x: 0, y: 0, width: 1, height: 10000 },
      target: { x: 539, y: 0, width: 1, height: 1080 },
    });
    expect(exactPlacement(size(10000, 1), { ...box, fit: 'fit' })).toMatchObject({
      target: { x: 0, y: 539, width: 1080, height: 1 },
    });
    expect(exactPlacement(size(1, 10000), { ...box, fit: 'fill' })).toEqual({
      canvas: box,
      source: { x: 0, y: 4460, width: 1, height: 1080 },
      target: { x: 539, y: 0, width: 1, height: 1080 },
      padded: true,
      cropped: true,
      enlarged: false,
    });
    expect(exactPlacement(size(10000, 1), { ...box, fit: 'fill', upscale: true })).toEqual({
      canvas: box,
      source: { x: 4999, y: 0, width: 1, height: 1 },
      target: { x: 0, y: 0, width: 1080, height: 1080 },
      padded: false,
      cropped: true,
      enlarged: true,
    });
  });
});

group('exactPlacement — fit', () => {
  it('never enlarges by default; with upscale fills one side of the box', () => {
    const o: ExactOptions = { width: 1080, height: 1080, fit: 'fit' };
    expect(exactPlacement(size(800, 600), o)).toEqual({
      canvas: { width: 1080, height: 1080 },
      source: { x: 0, y: 0, width: 800, height: 600 },
      target: { x: 140, y: 240, width: 800, height: 600 },
      padded: true,
      cropped: false,
      enlarged: false,
    });
    expect(exactPlacement(size(800, 600), { ...o, upscale: true })).toEqual({
      canvas: { width: 1080, height: 1080 },
      source: { x: 0, y: 0, width: 800, height: 600 },
      target: { x: 0, y: 135, width: 1080, height: 810 },
      padded: true,
      cropped: false,
      enlarged: true,
    });
  });

  it('same aspect ratio as the box → covers it exactly, not padded', () => {
    expect(exactPlacement(size(4000, 3000), { width: 800, height: 600, fit: 'fit' })).toMatchObject(
      {
        target: { x: 0, y: 0, width: 800, height: 600 },
        padded: false,
        cropped: false,
      },
    );
  });

  it('centres with an odd gap by rounding the offset down', () => {
    expect(exactPlacement(size(801, 600), { width: 1080, height: 1080, fit: 'fit' })).toMatchObject(
      {
        target: { x: 139, y: 240, width: 801, height: 600 },
      },
    );
  });

  const fitAnchors: Array<[Anchor, number, number]> = [
    ['top-left', 0, 0],
    ['top', 140, 0],
    ['top-right', 280, 0],
    ['left', 0, 240],
    ['center', 140, 240],
    ['right', 280, 240],
    ['bottom-left', 0, 480],
    ['bottom', 140, 480],
    ['bottom-right', 280, 480],
  ];
  it.each(fitAnchors)('anchor %s places the image at (%i, %i)', (anchor, x, y) => {
    const p = exactPlacement(size(800, 600), { width: 1080, height: 1080, fit: 'fit', anchor });
    expect(p.source).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(p.target).toEqual({ x, y, width: 800, height: 600 });
    expect(p.padded).toBe(true);
    expect(p.cropped).toBe(false);
  });

  it('defaults to center', () => {
    const o: ExactOptions = { width: 1080, height: 1080, fit: 'fit' };
    expect(exactPlacement(size(800, 600), o)).toEqual(
      exactPlacement(size(800, 600), { ...o, anchor: 'center' }),
    );
  });

  it('fractional box (PDF points) is rounded to whole units; fractional source kept whole', () => {
    const page = exactPlacement(size(841.89, 595.28), {
      width: 595.28,
      height: 841.89,
      fit: 'fit',
      upscale: true,
    });
    expect(page).toEqual({
      canvas: { width: 595, height: 842 },
      source: { x: 0, y: 0, width: 841.89, height: 595.28 },
      target: { x: 0, y: 210, width: 595, height: 421 },
      padded: true,
      cropped: false,
      enlarged: false,
    });
  });
});

group('exactPlacement — fill', () => {
  it('covers the box exactly when shrinking, cropping the overflow', () => {
    expect(exactPlacement(size(3000, 2000), { width: 1000, height: 1000, fit: 'fill' })).toEqual({
      canvas: { width: 1000, height: 1000 },
      source: { x: 500, y: 0, width: 2000, height: 2000 },
      target: { x: 0, y: 0, width: 1000, height: 1000 },
      padded: false,
      cropped: true,
      enlarged: false,
    });
    // Portrait into landscape: crop height, rounded to whole pixels (1000 × 1080 / 1920 = 562.5 → 563).
    expect(
      exactPlacement(size(1000, 3000), { width: 1920, height: 1080, fit: 'fill', upscale: true }),
    ).toEqual({
      canvas: { width: 1920, height: 1080 },
      source: { x: 0, y: 1218, width: 1000, height: 563 },
      target: { x: 0, y: 0, width: 1920, height: 1080 },
      padded: false,
      cropped: true,
      enlarged: true,
    });
  });

  it('same aspect ratio as the box → nothing cropped', () => {
    expect(
      exactPlacement(size(4000, 3000), { width: 800, height: 600, fit: 'fill' }),
    ).toMatchObject({
      source: { x: 0, y: 0, width: 4000, height: 3000 },
      target: { x: 0, y: 0, width: 800, height: 600 },
      padded: false,
      cropped: false,
    });
  });

  it('image smaller than the box without upscale behaves like fit (padded, not enlarged)', () => {
    const o: ExactOptions = { width: 1080, height: 1080, fit: 'fill' };
    const fill = exactPlacement(size(800, 600), o);
    expect(fill).toEqual(exactPlacement(size(800, 600), { ...o, fit: 'fit' }));
    expect(fill).toMatchObject({ padded: true, cropped: false, enlarged: false });
  });

  it('image smaller than the box with upscale is enlarged to cover it', () => {
    expect(
      exactPlacement(size(800, 600), { width: 1080, height: 1080, fit: 'fill', upscale: true }),
    ).toEqual({
      canvas: { width: 1080, height: 1080 },
      source: { x: 100, y: 0, width: 600, height: 600 },
      target: { x: 0, y: 0, width: 1080, height: 1080 },
      padded: false,
      cropped: true,
      enlarged: true,
    });
  });

  it('one side too long, the other too short, no upscale → crops one side and pads the other', () => {
    expect(exactPlacement(size(2000, 500), { width: 1080, height: 1080, fit: 'fill' })).toEqual({
      canvas: { width: 1080, height: 1080 },
      source: { x: 460, y: 0, width: 1080, height: 500 },
      target: { x: 0, y: 290, width: 1080, height: 500 },
      padded: true,
      cropped: true,
      enlarged: false,
    });
  });

  const fillAnchors: Array<[Anchor, number, number, number]> = [
    // anchor, source x (crop 9000×2600 wide image), source x / target y (2000×500, no upscale)
    ['top-left', 0, 0, 0],
    ['top', 3200, 460, 0],
    ['top-right', 6400, 920, 0],
    ['left', 0, 0, 290],
    ['center', 3200, 460, 290],
    ['right', 6400, 920, 290],
    ['bottom-left', 0, 0, 580],
    ['bottom', 3200, 460, 580],
    ['bottom-right', 6400, 920, 580],
  ];
  it.each(fillAnchors)(
    'anchor %s crops at x=%i (and x=%i, y=%i when padding)',
    (anchor, wideX, x, y) => {
      const box = { width: 1080, height: 1080, fit: 'fill' as const, anchor };
      expect(exactPlacement(size(9000, 2600), box)).toMatchObject({
        source: { x: wideX, y: 0, width: 2600, height: 2600 },
        target: { x: 0, y: 0, width: 1080, height: 1080 },
      });
      expect(exactPlacement(size(2000, 500), box)).toMatchObject({
        source: { x, y: 0, width: 1080, height: 500 },
        target: { x: 0, y, width: 1080, height: 500 },
      });
    },
  );

  it.each(fillAnchors)('anchor %s crops tall images vertically too', (anchor) => {
    const p = exactPlacement(size(2600, 9000), { width: 1080, height: 1080, fit: 'fill', anchor });
    const expectedY = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 6400 : 3200;
    expect(p.source).toEqual({ x: 0, y: expectedY, width: 2600, height: 2600 });
  });

  group('upscaling by more than 2× (whole source pixels cannot always match the box)', () => {
    it('slice a little short → pads the gap rather than stretching', () => {
      // scale 70/3: 4 source px → 93.3 target px; 5 would be 116.7 > 100.
      expect(
        exactPlacement(size(5, 3), { width: 100, height: 70, fit: 'fill', upscale: true }),
      ).toEqual({
        canvas: { width: 100, height: 70 },
        source: { x: 0, y: 0, width: 4, height: 3 },
        target: { x: 3, y: 0, width: 93, height: 70 },
        padded: true,
        cropped: true,
        enlarged: true,
      });
    });

    it('nearest slice too long → one source pixel less, padded', () => {
      // ideal slice 110 × 3 / 70 = 4.71 → 5 would draw 116.7 px > 110, so use 4 (93 px).
      expect(
        exactPlacement(size(5, 3), { width: 110, height: 70, fit: 'fill', upscale: true }),
      ).toEqual({
        canvas: { width: 110, height: 70 },
        source: { x: 0, y: 0, width: 4, height: 3 },
        target: { x: 8, y: 0, width: 93, height: 70 },
        padded: true,
        cropped: true,
        enlarged: true,
      });
    });

    it('slice within 1 px of the box → covers the box', () => {
      // scale 3: 10 source px → 30 target px, box 31 (1 px of rounding).
      expect(
        exactPlacement(size(20, 10), { width: 31, height: 30, fit: 'fill', upscale: true }),
      ).toMatchObject({
        source: { x: 5, y: 0, width: 10, height: 10 },
        target: { x: 0, y: 0, width: 31, height: 30 },
        padded: false,
      });
    });

    it('one source pixel wider than the box → that pixel fills the box (a sub-pixel crop)', () => {
      expect(
        exactPlacement(size(3, 1), { width: 10, height: 100, fit: 'fill', upscale: true }),
      ).toEqual({
        canvas: { width: 10, height: 100 },
        source: { x: 1, y: 0, width: 1, height: 1 },
        target: { x: 0, y: 0, width: 10, height: 100 },
        padded: false,
        cropped: true,
        enlarged: true,
      });
    });

    it('one source pixel a little short of the box → padded, never stretched', () => {
      // Scale 100: 1 source px → 100 px, box 120. Stretching it to 120 would distort; pad instead.
      expect(
        exactPlacement(size(1, 10), { width: 100, height: 120, fit: 'fill', upscale: true }),
      ).toEqual({
        canvas: { width: 100, height: 120 },
        source: { x: 0, y: 4, width: 1, height: 1 },
        target: { x: 0, y: 10, width: 100, height: 100 },
        padded: true,
        cropped: true,
        enlarged: true,
      });
    });
  });
});

group('exactPlacement — invalid input throws RangeError', () => {
  const bad = [0, -1, NaN, Infinity, -Infinity, loose<number>('1080'), loose<number>(null)];
  const ok: ExactOptions = { width: 1080, height: 1080, fit: 'fit' };

  it.each(bad)('source size %s', (value) => {
    expect(() => exactPlacement(size(value, 100), ok)).toThrow(/Source width/);
    expect(() => exactPlacement(size(100, value), ok)).toThrow(/Source height/);
  });

  it.each(bad)('box size %s', (value) => {
    expect(() => exactPlacement(size(100, 100), { ...ok, width: value })).toThrow(/Box width/);
    expect(() => exactPlacement(size(100, 100), { ...ok, height: value })).toThrow(/Box height/);
    expect(() => exactPlacement(size(100, 100), { ...ok, height: value })).toThrow(RangeError);
  });

  it('unknown fit — there is no stretch mode', () => {
    expect(() => exactPlacement(size(100, 100), { ...ok, fit: loose<'fit'>('stretch') })).toThrow(
      /Fit must be one of fit, fill \(got "stretch"\)/,
    );
  });

  it('unknown anchor', () => {
    expect(() =>
      exactPlacement(size(100, 100), { ...ok, anchor: loose<Anchor>('middle') }),
    ).toThrow(/Anchor must be one of .* \(got "middle"\)/);
  });
});

group('helpers', () => {
  it('aspectRatio is width / height', () => {
    expect(aspectRatio(size(1920, 1080))).toBe(16 / 9);
    expect(aspectRatio(size(3024, 4032))).toBe(0.75);
    expect(() => aspectRatio(size(0, 1))).toThrow(RangeError);
    expect(() => aspectRatio(size(1, NaN))).toThrow(RangeError);
  });

  it('describe gives "source → output"', () => {
    const src = size(4032, 3024);
    expect(describe(src, fitSize(src, { mode: 'longest', value: 1920 }))).toBe(
      '4032×3024 → 1920×1440',
    );
    expect(
      describe(
        size(9000, 2600),
        exactPlacement(size(9000, 2600), { width: 1080, height: 1080, fit: 'fill' }),
      ),
    ).toBe('9000×2600 → 1080×1080');
    expect(describe(size(800, 600), size(800, 600))).toBe('800×600 → 800×600');
  });
});
