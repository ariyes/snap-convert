import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '@/features/settings';
import {
  DEFAULTS,
  dpiOf,
  pageDigits,
  pageFileName,
  pageJobInput,
  planPages,
  SCHEMA,
  type PageNameContext,
} from './settings';

describe('settings', () => {
  it('defaults to JPG at 150 dpi with Auto quality', () => {
    expect(DEFAULTS).toMatchObject({ format: 'jpeg', resolution: 'standard', qualityMode: 'auto' });
    expect(dpiOf(DEFAULTS)).toBe(150);
  });

  it('maps resolutions to DPI and keeps custom DPI within 36–600', () => {
    expect(dpiOf({ resolution: 'screen', customDpi: 1 })).toBe(72);
    expect(dpiOf({ resolution: 'print', customDpi: 1 })).toBe(300);
    expect(dpiOf({ resolution: 'custom', customDpi: 212.4 })).toBe(212);
    expect(dpiOf({ resolution: 'custom', customDpi: 5 })).toBe(36);
    expect(dpiOf({ resolution: 'custom', customDpi: 5000 })).toBe(600);
  });

  it('drops remembered values that are out of range', () => {
    const clean = sanitizeSettings(
      { ...DEFAULTS, customDpi: 9000, format: 'webp', rename: 'x'.repeat(500) },
      DEFAULTS,
      SCHEMA,
    );
    expect(clean).toEqual(DEFAULTS);
  });
});

describe('planPages', () => {
  it('saves every page by default', () => {
    expect(planPages('all', '', 4)).toEqual({ ok: true, pages: [1, 2, 3, 4] });
  });

  it('turns "1-3, 5" into pages 1, 2, 3 and 5, in page order, once each', () => {
    expect(planPages('choose', '1-3, 5', 10)).toEqual({ ok: true, pages: [1, 2, 3, 5] });
    expect(planPages('choose', '5, 1-3, 2', 10)).toEqual({ ok: true, pages: [1, 2, 3, 5] });
  });

  it("shows Split's exact messages for invalid ranges", () => {
    const error = (spec: string) => {
      const plan = planPages('choose', spec, 10);
      return plan.ok ? null : plan.error;
    };
    expect(error('3-1')).toBe('“3-1” is backwards — write it as 1-3');
    expect(error('1-3, 12')).toBe("Page 12 doesn't exist — this PDF has 10 pages");
    expect(error('1-3, x')).toBe("“x” isn't a page or range — use numbers like 1-3, 5, 8-10");
    expect(error('0')).toBe('Page numbers start at 1');
    expect(error('')).toBe('Enter the pages you want, like 1-3, 5, 8-10');
  });
});

describe('page file names', () => {
  const ctx = (page: number, pageCount: number): PageNameContext => ({
    pdfName: 'report.pdf',
    page,
    pageCount,
    width: 1240,
    height: 1754,
    format: 'jpeg',
  });

  it('pads page numbers to the page count, at least 2 digits', () => {
    expect(pageDigits(3)).toBe(2);
    expect(pageDigits(99)).toBe(2);
    expect(pageDigits(100)).toBe(3);
    expect(pageDigits(1200)).toBe(4);
  });

  it('names pages <pdf-name>-p01.jpg', () => {
    expect(pageFileName('{name}-p{n}', ctx(1, 3))).toBe('report-p01.jpg');
    expect(pageFileName('{name}-p{n}', ctx(57, 120))).toBe('report-p057.jpg');
    expect(pageFileName('{name}-p{n}', { ...ctx(2, 3), format: 'png' })).toBe('report-p02.png');
  });

  it('fills in the other tokens and falls back to the default pattern', () => {
    expect(pageFileName('{name}_{width}x{height}_{N}', ctx(4, 12))).toBe('report_1240x1754_04.jpg');
    expect(pageFileName('   ', ctx(4, 12))).toBe('report-p04.jpg');
    // A "{n}" inside the PDF's own name is left alone; unsafe characters go.
    expect(pageFileName('{name}-p{n}', { ...ctx(1, 2), pdfName: 'a{n}b:c.pdf' })).toBe(
      'a{n}bc-p01.jpg',
    );
  });
});

describe('pageJobInput', () => {
  const rendered = { blob: new Blob(['x']), width: 1240, height: 1754 };

  it('JPG in Auto: quality guard on, never resized, metadata stripped', () => {
    const input = pageJobInput(rendered, 'report-p01.png', DEFAULTS);
    expect(input).toEqual({
      file: rendered.blob,
      name: 'report-p01.png',
      format: 'jpeg',
      quality: 80,
      metadata: 'strip-all',
      qualityGuard: true,
      width: 1240,
      height: 1754,
    });
    expect(input).not.toHaveProperty('resize');
    expect(input).not.toHaveProperty('exact');
  });

  it("uses the user's own JPG quality as set, and PNG without the guard", () => {
    expect(
      pageJobInput(rendered, 'p', { format: 'jpeg', qualityMode: 'custom', quality: 65 }),
    ).toMatchObject({ quality: 65, qualityGuard: false });
    expect(pageJobInput(rendered, 'p', { ...DEFAULTS, format: 'png' })).toMatchObject({
      format: 'png',
      qualityGuard: false,
    });
  });
});
