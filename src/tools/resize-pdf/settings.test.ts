import { describe, expect, it } from 'vitest';
import { MAX_PAGE_POINTS, NAMED_PAGE_SIZES } from '@/engines/pdf';
import { parseSettings } from '@/features/settings';
import {
  contentScale,
  convertSide,
  formatSide,
  matchNamedSize,
  newPageSize,
  pageSizeInput,
  previewLayout,
  RESIZE_DEFAULTS,
  resizeSettingsSchema,
  settingsKey,
  toPoints,
  type ResizeSettings,
} from './settings';

const A4 = NAMED_PAGE_SIZES.a4;
const LETTER = NAMED_PAGE_SIZES.letter;
const with_ = (patch: Partial<ResizeSettings>): ResizeSettings => ({
  ...RESIZE_DEFAULTS,
  ...patch,
});

describe('page size input', () => {
  it('passes named sizes through and turns custom sizes into points', () => {
    expect(pageSizeInput(with_({ size: 'letter' }))).toBe('letter');
    const mm = pageSizeInput(with_({ size: 'custom', customWidth: 100, customHeight: 50 }));
    if (typeof mm === 'string') throw new Error('expected a custom size');
    expect(mm.width).toBeCloseTo(283.46, 2);
    expect(mm.height).toBeCloseTo(141.73, 2);
    const inches = pageSizeInput(
      with_({ size: 'custom', unit: 'in', customWidth: 8.5, customHeight: 11 }),
    );
    expect(inches).toEqual({ width: 612, height: 792 });
  });

  it('keeps custom sides within PDF limits', () => {
    expect(toPoints(5080, 'mm')).toBeLessThanOrEqual(MAX_PAGE_POINTS);
    expect(toPoints(500, 'in')).toBe(MAX_PAGE_POINTS);
    expect(toPoints(0.001, 'mm')).toBe(1);
  });

  it('converts between mm and inches', () => {
    expect(convertSide(210, 'mm', 'in')).toBe(8.27);
    expect(convertSide(8.5, 'in', 'mm')).toBe(215.9);
    expect(convertSide(1, 'mm', 'in')).toBe(0.1); // the smallest inch value
    expect(convertSide(42, 'mm', 'mm')).toBe(42);
  });

  it('changes the settings key only when the output would change', () => {
    expect(settingsKey(with_({ unit: 'in' }))).toBe(settingsKey(RESIZE_DEFAULTS));
    expect(settingsKey(with_({ size: 'letter' }))).not.toBe(settingsKey(RESIZE_DEFAULTS));
    expect(settingsKey(with_({ orientation: 'landscape' }))).not.toBe(settingsKey(RESIZE_DEFAULTS));
  });

  it('falls back to defaults for bad stored values', () => {
    const raw = JSON.stringify({ size: 'b5', orientation: 'portrait', customWidth: -3 });
    expect(parseSettings(raw, RESIZE_DEFAULTS, resizeSettingsSchema)).toEqual({
      ...RESIZE_DEFAULTS,
      orientation: 'portrait',
    });
  });
});

describe('new page size and scale', () => {
  it('auto orientation follows each page', () => {
    const landscape = { width: 792, height: 612 };
    expect(newPageSize(landscape, with_({ size: 'a4' }))).toEqual({
      width: A4.height,
      height: A4.width,
    });
    expect(newPageSize(LETTER, with_({ size: 'a4' }))).toEqual(A4);
    expect(newPageSize(landscape, with_({ orientation: 'portrait' }))).toEqual(A4);
  });

  it('scales A4 → Letter and Letter → A4 by the limiting side', () => {
    expect(contentScale(A4, LETTER)).toBeCloseTo(792 / 841.89, 3);
    expect(contentScale(LETTER, A4)).toBeCloseTo(595.28 / 612, 3);
  });
});

describe('preview layout', () => {
  const box = { width: 280, height: 210 };

  it('fits the new page in the box and centres the content without stretching', () => {
    const layout = previewLayout(A4, with_({ size: 'letter' }), box);
    expect(layout.pageSize).toEqual(LETTER);
    expect(layout.page.height).toBe(210);
    expect(Math.abs(layout.page.x - (280 - layout.page.width) / 2)).toBeLessThanOrEqual(1);
    // Same aspect as the content (within rounding) and centred on the page.
    const { content, page } = layout;
    expect(content.width / content.height).toBeCloseTo(A4.width / A4.height, 1);
    expect(Math.abs(content.x - (page.width - content.width - content.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(content.y - (page.height - content.height - content.y))).toBeLessThanOrEqual(1);
  });
});

describe('labels', () => {
  it('recognises named sizes either way round', () => {
    expect(matchNamedSize(A4)).toBe('a4');
    expect(matchNamedSize({ width: 792, height: 612 })).toBe('letter');
    expect(matchNamedSize({ width: 400, height: 400 })).toBeNull();
  });

  it('formats sides', () => {
    expect(formatSide(A4.width, 'mm')).toBe('210');
    expect(formatSide(612, 'in')).toBe('8.5');
  });
});
