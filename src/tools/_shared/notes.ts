// Turns an image job result into the plain-words notes shown under the preview (D24, D28, D30).
import type { ImageJobResult } from '@/core/contracts/image';
import { formatLabels, singleImageStrings as strings } from './strings';

export interface ResultNote {
  id: string;
  text: string;
  /** Worth the user's attention (e.g. bigger than the original); otherwise just information. */
  tone: 'info' | 'warn';
}

export interface ResultNoteSource {
  /** The input file's size in bytes. */
  bytes: number;
  /** The output dimensions differ from the source (changes the advice for a bigger file). */
  resized: boolean;
  /** The input is a HEIC photo: JPG and PNG are always bigger, which is expected. */
  heic?: boolean;
}

/**
 * Notes for one result. `reduced-decode` and `target-unreachable` aren't shown: the first is
 * internal, and these tools have no target size. The graphic hint is shown by <FormatSelect>.
 */
export function resultNotes(
  result: Pick<ImageJobResult, 'notes' | 'bytes' | 'format'>,
  source: ResultNoteSource,
): ResultNote[] {
  const out: ResultNote[] = [];
  const has = (note: ImageJobResult['notes'][number]) => result.notes.includes(note);
  const format = formatLabels[result.format];

  if (result.bytes > source.bytes && !has('kept-original')) {
    out.push(
      source.heic
        ? { id: 'larger', text: strings.notes.largerThanHeic(format), tone: 'info' }
        : { id: 'larger', text: strings.notes.larger(format, source.resized), tone: 'warn' },
    );
  }
  if (has('kept-original'))
    out.push({ id: 'kept', text: strings.notes.keptOriginal, tone: 'info' });
  if (has('not-enlarged')) {
    out.push({ id: 'not-enlarged', text: strings.notes.notEnlarged, tone: 'info' });
  }
  if (has('padded')) out.push({ id: 'padded', text: strings.notes.padded, tone: 'info' });
  if (has('cropped')) out.push({ id: 'cropped', text: strings.notes.cropped, tone: 'info' });
  if (has('format-fallback')) {
    out.push({ id: 'fallback', text: strings.notes.formatFallback(format), tone: 'info' });
  }
  if (has('metadata-jpeg-only')) {
    out.push({ id: 'jpeg-only', text: strings.notes.metadataJpegOnly, tone: 'info' });
  }
  if (has('guard-short')) out.push({ id: 'grainy', text: strings.notes.guardShort, tone: 'info' });
  return out;
}
