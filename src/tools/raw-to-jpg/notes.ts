// Plain-words notes for one converted RAW file (D24, D30): how it was made (the camera's JPEG or a
// develop, full or half size) plus the shared image notes (larger, not enlarged, saved as …).

import type { ImageJobResult, RawOptions } from '@/core/contracts/image';
import { resultNotes, type ResultNote } from '@/tools/_shared';
import { rawToJpgStrings as t } from './strings';

export interface RawNoteContext {
  /** The RAW file's size in bytes. */
  bytes: number;
  /** The output was resized (changes the advice for a bigger file). */
  resized: boolean;
  mode: RawOptions['mode'];
  /** This device is a phone (for the half-size note's wording). */
  phone: boolean;
}

export function rawResultNotes(
  result: Pick<ImageJobResult, 'notes' | 'bytes' | 'format'>,
  ctx: RawNoteContext,
): ResultNote[] {
  const out: ResultNote[] = [];
  const has = (note: ImageJobResult['notes'][number]) => result.notes.includes(note);
  if (has('raw-preview')) {
    out.push({ id: 'raw-preview', text: t.notes.cameraJpeg, tone: 'info' });
  } else if (ctx.mode === 'fast') {
    // Fast mode, but the camera's JPEG was too small (or missing): developed instead.
    out.push({ id: 'raw-developed', text: t.notes.developedInstead, tone: 'info' });
  }
  if (has('raw-half-size')) {
    out.push({
      id: 'raw-half-size',
      text: ctx.phone ? t.notes.halfSizePhone : t.notes.halfSizeDevice,
      tone: 'warn',
    });
  }
  out.push(...resultNotes(result, { bytes: ctx.bytes, resized: ctx.resized }));
  return out;
}
