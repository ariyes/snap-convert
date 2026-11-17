// What a split will produce, worked out live on the main thread (the same rules the PDF worker
// uses), so the page grid, the part count and the error under the ranges field are always current.
import { parseRanges, pdfStrings } from '@/engines/pdf';

export const SPLIT_MODES = ['every-page', 'every-n', 'ranges'] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export type SplitPlan = { ok: true; groups: number[][] } | { ok: false; error: string };

/** The parts (1-based page numbers each) for a split, or the message explaining what's wrong. */
export function planSplit(
  mode: SplitMode,
  n: number,
  ranges: string,
  pageCount: number,
): SplitPlan {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: pdfStrings.noPages() };
  }
  const all = Array.from({ length: pageCount }, (_, i) => i + 1);
  switch (mode) {
    case 'every-page':
      return { ok: true, groups: all.map((page) => [page]) };
    case 'every-n': {
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: pdfStrings.badEveryN };
      const groups: number[][] = [];
      for (let i = 0; i < pageCount; i += n) groups.push(all.slice(i, i + n));
      return { ok: true, groups };
    }
    case 'ranges':
      try {
        return { ok: true, groups: parseRanges(ranges, pageCount) };
      } catch (error) {
        if (error instanceof RangeError) return { ok: false, error: error.message };
        throw error;
      }
  }
}

type Span = [from: number, to: number];

function spanText([from, to]: Span): string {
  return from === to ? String(from) : `${from}-${to}`;
}

/** "1-3, 5, 8-10" for these parts (each part is a run of consecutive pages). */
export function rangesText(groups: readonly number[][]): string {
  return groups
    .filter((g) => g.length > 0)
    .map((g) => spanText([g[0] ?? 1, g[g.length - 1] ?? 1]))
    .join(', ');
}

/** The pages the user picked as parts, as from–to spans (empty when the text isn't valid yet). */
function spansOf(spec: string, pageCount: number): Span[] {
  try {
    return parseRanges(spec, pageCount).map((g): Span => [g[0] ?? 1, g[g.length - 1] ?? 1]);
  } catch {
    return [];
  }
}

/**
 * Clicking a page thumbnail in Custom ranges: a picked page is taken out of its part(s), splitting
 * a part in two if needed; an unpicked page extends the part that ends just before it (or starts
 * just after it), or becomes a part of its own, in page order.
 */
export function togglePage(spec: string, page: number, pageCount: number): string {
  let spans = spansOf(spec, pageCount);
  if (spans.some(([a, b]) => a <= page && page <= b)) {
    spans = spans.flatMap(([a, b]): Span[] => {
      if (page < a || page > b) return [[a, b]];
      const out: Span[] = [];
      if (a <= page - 1) out.push([a, page - 1]);
      if (page + 1 <= b) out.push([page + 1, b]);
      return out;
    });
  } else {
    const before = spans.findIndex(([, b]) => b === page - 1);
    const after = spans.findIndex(([a]) => a === page + 1);
    if (before >= 0) {
      const [a] = spans[before]!;
      spans[before] = [a, page];
    } else if (after >= 0) {
      const [, b] = spans[after]!;
      spans[after] = [page, b];
    } else {
      const at = spans.findIndex(([a]) => a > page);
      spans.splice(at < 0 ? spans.length : at, 0, [page, page]);
    }
  }
  return spans.map(spanText).join(', ');
}
