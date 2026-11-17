import { describe, expect, it } from 'vitest';
import type { Rect } from '@/core/sizing';
import { mmToPoints } from '@/engines/pdf';
import { pageSizeFor, previewLayout, PREVIEW_BOX, type PageOptions } from './page-layout';

const a4: PageOptions = { pageSize: 'a4', orientation: 'auto', marginMm: 0 };
const ratio = (r: Rect, box = PREVIEW_BOX) =>
  (r.width * box.width) / 100 / ((r.height * box.height) / 100);

describe('pageSizeFor', () => {
  it('turns fixed pages to match the image with Auto', () => {
    expect(pageSizeFor({ width: 4000, height: 3000 }, a4)).toEqual({
      width: 841.89,
      height: 595.28,
    });
    expect(pageSizeFor({ width: 3000, height: 4000 }, a4)).toEqual({
      width: 595.28,
      height: 841.89,
    });
    // A square image gets a portrait page.
    expect(pageSizeFor({ width: 500, height: 500 }, { ...a4, pageSize: 'letter' })).toEqual({
      width: 612,
      height: 792,
    });
  });

  it('keeps the chosen orientation whatever the image', () => {
    const landscape = { ...a4, orientation: 'landscape' as const };
    expect(pageSizeFor({ width: 300, height: 4000 }, landscape)).toEqual({
      width: 841.89,
      height: 595.28,
    });
    const portrait = { ...a4, pageSize: 'legal' as const, orientation: 'portrait' as const };
    expect(pageSizeFor({ width: 4000, height: 300 }, portrait)).toEqual({
      width: 612,
      height: 1008,
    });
  });

  it('fit to image: 1 px = 1 pt plus the margins, shrunk to 200 inches', () => {
    const fit: PageOptions = { pageSize: 'fit-image', orientation: 'landscape', marginMm: 10 };
    const m = mmToPoints(10);
    const page = pageSizeFor({ width: 90, height: 60 }, fit);
    expect(page.width).toBeCloseTo(90 + 2 * m, 6);
    expect(page.height).toBeCloseTo(60 + 2 * m, 6);

    const huge = pageSizeFor({ width: 40_000, height: 10_000 }, { ...fit, marginMm: 0 });
    expect(huge).toEqual({ width: 14_400, height: 3_600 });
  });
});

describe('previewLayout', () => {
  const sizes = [
    { width: 4032, height: 3024 },
    { width: 3024, height: 4032 },
    { width: 9000, height: 2600 },
    { width: 1, height: 1 },
    { width: 37, height: 1999 },
  ];
  const options: PageOptions[] = [
    a4,
    { pageSize: 'letter', orientation: 'portrait', marginMm: 10 },
    { pageSize: 'a5', orientation: 'landscape', marginMm: 20 },
    { pageSize: 'fit-image', orientation: 'auto', marginMm: 20 },
  ];

  it('never stretches the image or the page', () => {
    for (const size of sizes) {
      for (const o of options) {
        const layout = previewLayout(size, o);
        const page = pageSizeFor(size, o);
        // Whole-unit rounding of a 1000-unit box: within one unit.
        expect(Math.abs(ratio(layout.pageRect) / (page.width / page.height) - 1)).toBeLessThan(
          0.01,
        );
        const imageRatio = ratio(layout.imageRect);
        const tolerance = 2 / Math.min(layout.imageRect.width * 10, layout.imageRect.height * 13);
        expect(Math.abs(imageRatio / (size.width / size.height) - 1)).toBeLessThan(
          Math.max(0.01, tolerance),
        );
      }
    }
  });

  it('places the image inside the margins, centred, touching one pair of sides', () => {
    const layout = previewLayout({ width: 4000, height: 3000 }, { ...a4, marginMm: 20 });
    const { contentRect: c, imageRect: img, pageRect: p } = layout;
    expect(layout.landscape).toBe(true);
    expect(c.x).toBeGreaterThan(p.x);
    expect(img.x).toBeGreaterThanOrEqual(c.x);
    expect(img.y).toBeGreaterThanOrEqual(c.y);
    expect(img.x + img.width).toBeLessThanOrEqual(c.x + c.width + 1e-9);
    expect(img.y + img.height).toBeLessThanOrEqual(c.y + c.height + 1e-9);
    const touchesSides = Math.abs(img.width - c.width) < 0.11;
    const touchesTopBottom = Math.abs(img.height - c.height) < 0.11;
    expect(touchesSides || touchesTopBottom).toBe(true);
    // Centred.
    expect(Math.abs(img.x - c.x - (c.x + c.width - img.x - img.width))).toBeLessThan(0.11);
    expect(Math.abs(img.y - c.y - (c.y + c.height - img.y - img.height))).toBeLessThan(0.11);
  });

  it('scales small images up to fill a fixed page (as the PDF does)', () => {
    const layout = previewLayout({ width: 90, height: 60 }, a4);
    expect(layout.imageRect.width).toBeCloseTo(layout.pageRect.width, 1);
  });

  it('margins match their size on the page', () => {
    const layout = previewLayout({ width: 3000, height: 4000 }, { ...a4, marginMm: 20 });
    const marginShare = (layout.contentRect.x - layout.pageRect.x) / layout.pageRect.width;
    expect(marginShare).toBeCloseTo(mmToPoints(20) / 595.28, 2);
  });
});
