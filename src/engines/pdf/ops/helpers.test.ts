import { describe, expect, it, vi } from 'vitest';
import { PdfOpError, withTimeout } from './errors';
import { withExifOrientation } from './exif-test-data';
import { jpegOrientation, sniffImageType } from './image-bytes';
import { MAX_PAGE_POINTS, mmToPoints, orientPage, pageSizePoints } from './page-size';
import {
  imageMatrix,
  normalizeRotation,
  orientedSize,
  pageMatrix,
  rotatedSize,
  type Matrix,
} from './transforms';

const apply = (m: Matrix, u: number, v: number): [number, number] => [
  Math.round((m[0] * u + m[2] * v + m[4]) * 1000) / 1000,
  Math.round((m[1] * u + m[3] * v + m[5]) * 1000) / 1000,
];

describe('page sizes', () => {
  it('converts millimetres to points', () => {
    expect(mmToPoints(25.4)).toBeCloseTo(72, 10);
    expect(mmToPoints(0)).toBe(0);
  });

  it('knows the named sizes and checks custom ones', () => {
    expect(pageSizePoints('a4')).toEqual({ width: 595.28, height: 841.89 });
    expect(pageSizePoints('letter')).toEqual({ width: 612, height: 792 });
    expect(pageSizePoints({ width: 300, height: 500 })).toEqual({ width: 300, height: 500 });
    for (const bad of [0, -5, NaN, Infinity, MAX_PAGE_POINTS + 1]) {
      expect(() => pageSizePoints({ width: bad, height: 500 })).toThrow(PdfOpError);
    }
    expect(() => pageSizePoints('tabloid' as 'a4')).toThrow('between 1 and 14,400 points');
  });

  it('orients pages without changing their size', () => {
    const a4 = { width: 595.28, height: 841.89 };
    const wide = { width: 900, height: 600 };
    const tall = { width: 600, height: 900 };
    expect(orientPage(a4, 'auto', tall)).toEqual(a4);
    expect(orientPage(a4, 'auto', wide)).toEqual({ width: 841.89, height: 595.28 });
    expect(orientPage(a4, 'auto', { width: 500, height: 500 })).toEqual(a4);
    expect(orientPage(a4, 'portrait', wide)).toEqual(a4);
    expect(orientPage(a4, 'landscape', tall)).toEqual({ width: 841.89, height: 595.28 });
    expect(orientPage({ width: 800, height: 600 }, 'portrait', wide)).toEqual({
      width: 600,
      height: 800,
    });
  });
});

describe('image bytes', () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9);

  it('sniffs JPEG and PNG from the bytes', () => {
    expect(sniffImageType(jpeg)).toBe('jpeg');
    expect(sniffImageType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'png',
    );
    expect(sniffImageType(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it('reads the EXIF orientation in both byte orders', () => {
    for (let o = 1; o <= 8; o++) {
      expect(jpegOrientation(withExifOrientation(jpeg, o))).toBe(o);
      expect(jpegOrientation(withExifOrientation(jpeg, o, true))).toBe(o);
    }
  });

  it('falls back to 1 when there is no or broken EXIF', () => {
    expect(jpegOrientation(jpeg)).toBe(1);
    expect(jpegOrientation(withExifOrientation(jpeg, 9))).toBe(1);
    const broken = withExifOrientation(jpeg, 6);
    broken[6] = 0x00; // "Exif" header damaged
    expect(jpegOrientation(broken)).toBe(1);
    expect(jpegOrientation(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0x00))).toBe(1);
    expect(jpegOrientation(Uint8Array.of(0xff, 0xd8, 0x00, 0x00, 0x00, 0x00))).toBe(1);
  });
});

describe('image matrices', () => {
  // Stored image corners in PDF image space (v = 1 is the first stored row).
  const storedTopLeft: [number, number] = [0, 1];
  const storedTopRight: [number, number] = [1, 1];
  const box = { x: 10, y: 20, width: 60, height: 90 };
  const corner = {
    topLeft: [10, 110],
    topRight: [70, 110],
    bottomLeft: [10, 20],
    bottomRight: [70, 20],
  };

  // Where the stored top-left and top-right pixels must appear for each EXIF orientation.
  const expected: Record<number, [number[], number[]]> = {
    1: [corner.topLeft, corner.topRight],
    2: [corner.topRight, corner.topLeft],
    3: [corner.bottomRight, corner.bottomLeft],
    4: [corner.bottomLeft, corner.bottomRight],
    5: [corner.topLeft, corner.bottomLeft],
    6: [corner.topRight, corner.bottomRight],
    7: [corner.bottomRight, corner.topRight],
    8: [corner.bottomLeft, corner.topLeft],
  };

  it.each(Object.entries(expected))('orientation %s draws the right way up', (o, [tl, tr]) => {
    const m = imageMatrix(Number(o), box);
    expect(apply(m, ...storedTopLeft)).toEqual(tl);
    expect(apply(m, ...storedTopRight)).toEqual(tr);
  });

  it('swaps sides for orientations 5–8', () => {
    expect(orientedSize({ width: 900, height: 600 }, 6)).toEqual({ width: 600, height: 900 });
    expect(orientedSize({ width: 900, height: 600 }, 3)).toEqual({ width: 900, height: 600 });
  });
});

describe('page rotation', () => {
  it('normalises /Rotate values', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(360)).toBe(0);
  });

  it('swaps sides for quarter turns', () => {
    expect(rotatedSize({ width: 100, height: 200 }, 90)).toEqual({ width: 200, height: 100 });
    expect(rotatedSize({ width: 100, height: 200 }, 180)).toEqual({ width: 100, height: 200 });
  });

  // A 100×200 page drawn at scale 2 with its visible bottom-left at (5, 7).
  const size = { width: 100, height: 200 };
  it.each([
    // rotation, where the content's top-left (0, 200) lands, visible box size
    [0, [5, 407], [200, 400]],
    [90, [405, 207], [400, 200]], // turned clockwise: top-left goes to top-right
    [180, [205, 7], [200, 400]],
    [270, [5, 7], [400, 200]], // turned anticlockwise: top-left goes to bottom-left
  ] as const)('rotation %i lands inside the visible box', (rotation, topLeft, visible) => {
    const m = pageMatrix(rotation, size, 2, 5, 7);
    expect(apply(m, 0, 200)).toEqual(topLeft);
    const corners = [apply(m, 0, 0), apply(m, 100, 0), apply(m, 0, 200), apply(m, 100, 200)];
    expect(Math.min(...corners.map((c) => c[0]))).toBe(5);
    expect(Math.min(...corners.map((c) => c[1]))).toBe(7);
    expect(Math.max(...corners.map((c) => c[0]))).toBe(5 + visible[0]);
    expect(Math.max(...corners.map((c) => c[1]))).toBe(7 + visible[1]);
  });
});

describe('withTimeout', () => {
  it('passes the result through', async () => {
    await expect(withTimeout(Promise.resolve(5), 1000, () => new Error('slow'))).resolves.toBe(5);
  });

  it('rejects with the timeout error when the work never finishes', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => {});
      const result = withTimeout(never, 2000, () => new PdfOpError('timeout', 'too slow'));
      vi.advanceTimersByTime(2000);
      await expect(result).rejects.toThrow('too slow');
    } finally {
      vi.useRealTimers();
    }
  });
});
