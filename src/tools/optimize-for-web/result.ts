// What to tell the user about one optimized image (D24, D28, D30): the checklist under the result,
// plain-word notes and the "small for its use" warning. Pure functions, no React.
import type { ImageFormat, ImageJobResult } from '@/core/contracts/image';
import type { Size } from '@/core/contracts/sizing';
import { minRecommendedSide, getPreset, type PresetId } from '@/engines/optimize';
import { applyNamePattern, uniqueNames } from '@/features/export';
import { planSize, IMAGE_SETTINGS_DEFAULTS } from '@/features/image-settings';
import { formatNames, optimizeStrings as t } from './strings';

export interface ChecklistItem {
  /** False draws a warning instead of a tick (e.g. "Larger than the original"). */
  ok: boolean;
  text: string;
}

export type ResultNote =
  | { kind: 'kept-original'; text: string }
  | { kind: 'guard-short'; text: string }
  | { kind: 'larger'; text: string; suggestJpeg: boolean }
  | { kind: 'graphic'; text: string }
  | { kind: 'format-fallback'; text: string };

export interface ResultReport {
  checklist: ChecklistItem[];
  notes: ResultNote[];
}

const longestSide = (s: Size) => Math.max(s.width, s.height);

/** Pipeline format → the name users know (the pipeline can't return a format we don't offer). */
function formatName(format: ImageFormat): string {
  return format === 'png' ? 'PNG' : formatNames[format];
}

/**
 * "✓ Resized to 2048 px · ✓ Location removed · ✓ 84% smaller · ✓ Looks the same", plus notes.
 * `source`: the visible size from intake, if known. `inputBytes`: the original file size.
 */
export function describeResult(
  result: ImageJobResult,
  inputBytes: number,
  source?: Size,
): ResultReport {
  const checklist: ChecklistItem[] = [];
  const notes: ResultNote[] = [];
  const outSide = longestSide(result);
  const keptSize =
    result.notes.includes('not-enlarged') ||
    (source !== undefined && longestSide(source) <= outSide);
  const keptOriginal = result.notes.includes('kept-original');

  checklist.push({ ok: true, text: keptSize ? t.keptAt(outSide) : t.resizedTo(outSide) });
  checklist.push({ ok: true, text: t.locationRemoved });

  if (result.bytes < inputBytes) {
    const percent = Math.round((1 - result.bytes / inputBytes) * 100);
    checklist.push({ ok: true, text: percent >= 1 ? t.smaller(percent) : t.slightlySmaller });
  } else if (!keptOriginal) {
    notes.push({
      kind: 'larger',
      text: t.larger(formatName(result.format)),
      suggestJpeg: result.format !== 'jpeg',
    });
  }

  // D29: a result the guard couldn't lift to 0.97 says so, without alarm, instead of "Looks the same".
  if (result.notes.includes('guard-short')) notes.push({ kind: 'guard-short', text: t.guardShort });
  else checklist.push({ ok: true, text: t.looksSame });

  if (keptOriginal) notes.unshift({ kind: 'kept-original', text: t.keptOriginal });
  if (result.notes.includes('format-fallback')) {
    notes.push({ kind: 'format-fallback', text: t.formatFallback(formatName(result.format)) });
  }
  if (result.graphic) notes.push({ kind: 'graphic', text: t.graphic });
  return { checklist, notes };
}

/**
 * The warning for an image that will look soft at this destination, or null. The output size comes
 * from the sizing rule (planSize → fitSize), never enlarged; the warning names the source's long side.
 */
export function smallImageWarning(source: Size | undefined, destination: PresetId): string | null {
  if (!source) return null;
  const plan = planSize(source, {
    ...IMAGE_SETTINGS_DEFAULTS,
    resizeMode: 'longest',
    resizeSize: getPreset(destination).longestSide,
    upscale: false,
  });
  if (!plan || longestSide(plan.output) >= minRecommendedSide(destination)) return null;
  const use = t.smallUse[destination];
  return source.width >= source.height
    ? t.smallWide(source.width, use)
    : t.smallTall(source.height, use);
}

/** The planned output size before the job runs, e.g. "4032×3024 → 1920×1440". */
export function plannedSizeText(source: Size | undefined, destination: PresetId): string | null {
  if (!source) return null;
  const plan = planSize(source, {
    ...IMAGE_SETTINGS_DEFAULTS,
    resizeMode: 'longest',
    resizeSize: getPreset(destination).longestSide,
    upscale: false,
  });
  if (!plan) return null;
  const same = plan.output.width === source.width && plan.output.height === source.height;
  return same ? sizeText(source) : plan.text;
}

/** "photo.jpg" (pipeline name, new extension) → "photo-web.jpg". */
export function webName(resultName: string): string {
  const dot = resultName.lastIndexOf('.');
  const base = dot > 0 ? resultName.slice(0, dot) : resultName;
  const ext = dot > 0 ? resultName.slice(dot + 1) : 'jpg';
  return `${applyNamePattern('{name}-web', { name: base, n: 1, format: ext })}.${ext}`;
}

/** Export names for a list of results: `<name>-web.<ext>`, unique (ignoring case). */
export function webNames(resultNames: readonly string[]): string[] {
  return uniqueNames(resultNames.map(webName));
}

/** "4032×3024". */
export function sizeText(s: Size): string {
  return `${s.width}×${s.height}`;
}
