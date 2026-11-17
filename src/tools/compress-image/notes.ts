// What a result's pipeline notes mean, in plain words (D24, D28, D30), with one-tap fixes.
import type { ImageJobResult } from '@/core/contracts/image';
import type { CompressSettings } from './settings';
import { compressStrings as t, formatLabels } from './strings';

export interface ResultNote {
  id: 'kept-original' | 'guard-short' | 'bigger' | 'target-unreachable' | 'format-fallback';
  text: string;
  /** Warnings get the warning colour; the rest are quiet information. */
  tone: 'info' | 'warn';
  /** A one-tap fix: the settings patch and its button text. */
  action?: { label: string; patch: Partial<CompressSettings> };
}

type NoteSettings = Pick<
  CompressSettings,
  'metadata' | 'resizeEnabled' | 'targetKb' | 'qualityMode'
>;

/** Notes for one result, most useful first. `originalBytes` is the source file's size. */
export function resultNotes(
  result: Pick<
    ImageJobResult,
    'notes' | 'bytes' | 'format' | 'width' | 'height' | 'suggestedSize' | 'suggestedFormat'
  >,
  originalBytes: number,
  settings: NoteSettings,
): ResultNote[] {
  const has = (note: ImageJobResult['notes'][number]) => result.notes.includes(note);
  const out: ResultNote[] = [];
  const format = formatLabels[result.format];

  if (has('target-unreachable') && settings.qualityMode === 'target') {
    const size = result.suggestedSize;
    const suggested = result.suggestedFormat;
    if (suggested) {
      out.push({
        id: 'target-unreachable',
        tone: 'warn',
        text: t.targetUnreachableFormat(settings.targetKb),
        action: { label: t.switchTo(formatLabels[suggested]), patch: { format: suggested } },
      });
    } else {
      const longest = size ? Math.max(size.width, size.height) : undefined;
      out.push({
        id: 'target-unreachable',
        tone: 'warn',
        text: t.targetUnreachable(settings.targetKb, result.width, result.height),
        action:
          longest !== undefined && longest >= 1
            ? {
                label: t.resizeTo(longest),
                patch: { resizeEnabled: true, resizeMode: 'longest', resizeSize: longest },
              }
            : undefined,
      });
    }
  }

  if (has('kept-original')) {
    out.push({
      id: 'kept-original',
      tone: 'info',
      text: settings.metadata === 'keep-all' ? t.keptOriginal : t.keptOriginalStripped,
    });
  } else if (result.bytes > originalBytes) {
    out.push({
      id: 'bigger',
      tone: 'warn',
      text: settings.resizeEnabled ? t.bigger : t.biggerAtFullSize(format),
    });
  }

  if (has('format-fallback')) {
    out.push({ id: 'format-fallback', tone: 'info', text: t.formatFallback(format) });
  }

  if (has('guard-short')) out.push({ id: 'guard-short', tone: 'info', text: t.guardShort });

  return out;
}
