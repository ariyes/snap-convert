import { describe, expect, it } from 'vitest';
import type { ImageJobResult } from '@/core/contracts/image';
import { PRESET_IDS, getPreset, minRecommendedSide } from '@/engines/optimize';
import { describeResult, plannedSizeText, smallImageWarning, webName, webNames } from './result';
import { optimizeStrings as t } from './strings';

function result(patch: Partial<ImageJobResult> = {}): ImageJobResult {
  return {
    blob: new Blob(['x']),
    name: 'photo.jpg',
    width: 2048,
    height: 1536,
    bytes: 160_000,
    format: 'jpeg',
    quality: 80,
    ssim: 0.98,
    graphic: false,
    notes: [],
    ...patch,
  };
}

const texts = (r: ReturnType<typeof describeResult>) => r.checklist.map((c) => c.text);

describe('describeResult', () => {
  it('gives the four-item checklist for a normal result', () => {
    const r = describeResult(result(), 1_000_000, { width: 4032, height: 3024 });
    expect(texts(r)).toEqual([
      'Resized to 2048 px',
      'Location removed',
      '84% smaller',
      'Looks the same',
    ]);
    expect(r.notes).toEqual([]);
  });

  it('says "not enlarged" when the image was already small', () => {
    const r = describeResult(
      result({ width: 900, height: 600, notes: ['not-enlarged'] }),
      200_000,
      { width: 900, height: 600 },
    );
    expect(texts(r)[0]).toBe('Kept at 900 px (not enlarged)');
  });

  it('drops "Looks the same" for guard-short results and says why, calmly', () => {
    const r = describeResult(result({ notes: ['guard-short'] }), 1_000_000);
    expect(texts(r)).not.toContain(t.looksSame);
    expect(r.notes).toEqual([{ kind: 'guard-short', text: t.guardShort }]);
  });

  it('explains a kept original instead of claiming savings', () => {
    const r = describeResult(
      result({ width: 800, height: 600, bytes: 50_000, notes: ['kept-original'] }),
      50_000,
      { width: 800, height: 600 },
    );
    expect(texts(r)).toEqual([
      'Kept at 800 px (not enlarged)',
      'Location removed',
      'Looks the same',
    ]);
    expect(r.notes[0]).toEqual({ kind: 'kept-original', text: t.keptOriginal });
  });

  it('says plainly when the result is larger, and offers JPG for other formats', () => {
    const r = describeResult(result({ format: 'webp', name: 'a.webp', bytes: 60_000 }), 50_000);
    expect(texts(r).some((x) => x.includes('smaller'))).toBe(false);
    expect(r.notes[0]).toMatchObject({ kind: 'larger', suggestJpeg: true });
    expect(r.notes[0]?.text).toContain('Larger than the original');
  });

  it('notes graphics and format fallbacks', () => {
    const r = describeResult(result({ graphic: true, notes: ['format-fallback'] }), 1_000_000);
    expect(r.notes.map((n) => n.kind)).toEqual(['format-fallback', 'graphic']);
    expect(r.notes[0]?.text).toContain('JPG');
  });
});

describe('smallImageWarning', () => {
  it('warns below the recommended size for each destination, and not at or above it', () => {
    for (const id of PRESET_IDS) {
      const min = minRecommendedSide(id);
      expect(smallImageWarning({ width: min - 1, height: 100 }, id)).toBe(
        t.smallWide(min - 1, t.smallUse[id]),
      );
      expect(smallImageWarning({ width: min, height: 100 }, id)).toBeNull();
      expect(smallImageWarning({ width: 6000, height: 4000 }, id)).toBeNull();
    }
  });

  it('names the long side of portrait images', () => {
    expect(smallImageWarning({ width: 600, height: 900 }, 'blog')).toBe(
      'This image is 900 px tall — it may look soft as a full-width banner',
    );
  });

  it('matches the example from the task', () => {
    expect(smallImageWarning({ width: 900, height: 600 }, 'blog')).toBe(
      'This image is 900 px wide — it may look soft as a full-width banner',
    );
  });

  it('says nothing without a size', () => {
    expect(smallImageWarning(undefined, 'web')).toBeNull();
  });
});

describe('plannedSizeText', () => {
  it('uses the preset size and never enlarges', () => {
    expect(plannedSizeText({ width: 4032, height: 3024 }, 'wordpress')).toBe(
      `4032×3024 → ${getPreset('wordpress').longestSide}×1536`,
    );
    expect(plannedSizeText({ width: 300, height: 200 }, 'web')).toBe('300×200');
  });
});

describe('names', () => {
  it('adds -web before the extension', () => {
    expect(webName('photo.jpg')).toBe('photo-web.jpg');
    expect(webName('my.holiday.webp')).toBe('my.holiday-web.webp');
  });

  it('keeps names unique', () => {
    expect(webNames(['a.jpg', 'A.jpg', 'b.jpg'])).toEqual([
      'a-web.jpg',
      'A-web (2).jpg',
      'b-web.jpg',
    ]);
  });
});
