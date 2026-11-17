import { describe, expect, it } from 'vitest';
import type { ImageJobResult } from '@/core/contracts/image';
import { rawResultNotes } from './notes';
import { rawToJpgStrings as t } from './strings';

const result = (
  notes: ImageJobResult['notes'],
  bytes = 5_000_000,
): Pick<ImageJobResult, 'notes' | 'bytes' | 'format'> => ({ notes, bytes, format: 'jpeg' });

const ctx = { bytes: 25_000_000, resized: false, mode: 'fast' as const, phone: false };
const texts = (r: ReturnType<typeof result>, c = ctx) => rawResultNotes(r, c).map((n) => n.text);

describe('rawResultNotes', () => {
  it('fast mode with the camera’s JPEG says so', () => {
    expect(texts(result(['raw-preview']))).toEqual([t.notes.cameraJpeg]);
  });

  it('fast mode that had to develop says why', () => {
    expect(texts(result([]))).toEqual([t.notes.developedInstead]);
  });

  it('full quality says nothing about how, unless memory forced half size', () => {
    expect(texts(result([]), { ...ctx, mode: 'full' })).toEqual([]);
    const phone = rawResultNotes(result(['raw-half-size']), { ...ctx, mode: 'full', phone: true });
    expect(phone).toEqual([{ id: 'raw-half-size', text: t.notes.halfSizePhone, tone: 'warn' }]);
    expect(texts(result(['raw-half-size']), { ...ctx, mode: 'full' })).toEqual([
      t.notes.halfSizeDevice,
    ]);
  });

  it('adds the shared notes (e.g. not enlarged, bigger than the RAW)', () => {
    const notes = rawResultNotes(result(['raw-preview', 'not-enlarged'], 30_000_000), ctx);
    expect(notes.map((n) => n.id)).toEqual(['raw-preview', 'larger', 'not-enlarged']);
  });
});
