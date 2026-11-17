import { describe, expect, it } from 'vitest';
import type { ImageJobResult } from '@/core/contracts/image';
import { resultNotes } from './notes';
import { COMPRESS_DEFAULTS } from './settings';

type R = Parameters<typeof resultNotes>[0];
const result = (over: Partial<R> = {}): R => ({
  notes: [],
  bytes: 100_000,
  format: 'jpeg',
  width: 1280,
  height: 889,
  ...over,
});
const notes = (...n: ImageJobResult['notes']) => n;

describe('resultNotes', () => {
  it('says nothing for an ordinary result', () => {
    expect(resultNotes(result(), 160_000, COMPRESS_DEFAULTS)).toEqual([]);
  });

  it('target unreachable: offers the suggested size as a one-tap resize', () => {
    const [note] = resultNotes(
      result({
        notes: notes('target-unreachable'),
        bytes: 66_000,
        suggestedSize: { width: 993, height: 690 },
      }),
      160_000,
      { ...COMPRESS_DEFAULTS, qualityMode: 'target', targetKb: 50 },
    );
    expect(note?.id).toBe('target-unreachable');
    expect(note?.text).toContain("Can't reach 50 KB at 1280×889");
    expect(note?.action).toEqual({
      label: 'Resize to 993 px',
      patch: { resizeEnabled: true, resizeMode: 'longest', resizeSize: 993 },
    });
  });

  it('target unreachable as PNG: offers the suggested format', () => {
    const [note] = resultNotes(
      result({ notes: notes('target-unreachable'), format: 'png', suggestedFormat: 'jpeg' }),
      160_000,
      { ...COMPRESS_DEFAULTS, qualityMode: 'target', targetKb: 20 },
    );
    expect(note?.action).toEqual({ label: 'Switch to JPG', patch: { format: 'jpeg' } });
  });

  it('kept original: says so, mentioning removed location data unless details are kept', () => {
    const kept = result({ notes: notes('kept-original') });
    expect(resultNotes(kept, 100_000, COMPRESS_DEFAULTS)[0]?.text).toBe(
      'Your original was already well compressed — kept it (location data removed).',
    );
    expect(
      resultNotes(kept, 100_000, { ...COMPRESS_DEFAULTS, metadata: 'keep-all' })[0]?.text,
    ).toBe('Your original was already well compressed — kept it.');
  });

  it('bigger than the original: says so plainly', () => {
    const [note] = resultNotes(
      result({ bytes: 120_000, format: 'webp' }),
      100_000,
      COMPRESS_DEFAULTS,
    );
    expect(note).toMatchObject({ id: 'bigger', tone: 'warn' });
    expect(note?.text).toBe('Larger than the original — WebP at full size. Try resizing.');
  });

  it('grainy photo and format fallback', () => {
    const list = resultNotes(
      result({ notes: notes('guard-short', 'format-fallback') }),
      160_000,
      COMPRESS_DEFAULTS,
    );
    expect(list.map((n) => n.id)).toEqual(['format-fallback', 'guard-short']);
    expect(list[1]?.text).toBe('Very grainy photo — kept the best quality possible.');
  });
});
