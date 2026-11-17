// Organize pages: the page list, its edits and undo/redo, as plain functions (no React).
import type { OrganizeInput } from '@/core/contracts/pdf';

export type Rotation = 0 | 90 | 180 | 270;

/** One page of the result. `id` is the page's 0-based index in the original file. */
export interface PageItem {
  id: number;
  rotate: Rotation;
}

/** Every edit is a new `present`; undo and redo walk `past` and `future`. */
export interface History {
  past: PageItem[][];
  present: PageItem[];
  future: PageItem[][];
}

/** Most undo steps kept. */
export const MAX_UNDO = 200;

export function initialPages(count: number): PageItem[] {
  return Array.from({ length: count }, (_, id) => ({ id, rotate: 0 }));
}

export function createHistory(count: number): History {
  return { past: [], present: initialPages(count), future: [] };
}

/** Records `next` as a new step (no-op when nothing changed). Clears redo. */
export function commit(history: History, next: PageItem[]): History {
  if (samePages(history.present, next)) return history;
  const past = [...history.past, history.present];
  if (past.length > MAX_UNDO) past.shift();
  return { past, present: next, future: [] };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

export function samePages(a: readonly PageItem[], b: readonly PageItem[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i]?.id && p.rotate === b[i]?.rotate);
}

export function normalize(angle: number): Rotation {
  const r = ((angle % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/** Turns the pages in `ids` by `delta` degrees (90 = clockwise). */
export function rotatePages(
  pages: readonly PageItem[],
  ids: ReadonlySet<number>,
  delta: number,
): PageItem[] {
  return pages.map((p) => (ids.has(p.id) ? { ...p, rotate: normalize(p.rotate + delta) } : p));
}

export function deletePages(pages: readonly PageItem[], ids: ReadonlySet<number>): PageItem[] {
  return pages.filter((p) => !ids.has(p.id));
}

/**
 * Moves the pages in `ids` (keeping their order) so they start at position `before` of the
 * current list — `before` counts every page, moved ones included (0 = start, length = end).
 */
export function movePagesBefore(
  pages: readonly PageItem[],
  ids: ReadonlySet<number>,
  before: number,
): PageItem[] {
  const moving = pages.filter((p) => ids.has(p.id));
  if (moving.length === 0) return [...pages];
  const at = Math.max(0, Math.min(before, pages.length));
  // Where `before` lands once the moving pages are taken out.
  const insertAt = pages.slice(0, at).filter((p) => !ids.has(p.id)).length;
  const rest = pages.filter((p) => !ids.has(p.id));
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}

export function movePagesTo(
  pages: readonly PageItem[],
  ids: ReadonlySet<number>,
  where: 'start' | 'end',
): PageItem[] {
  return movePagesBefore(pages, ids, where === 'start' ? 0 : pages.length);
}

/**
 * Moves the selected pages one step earlier (-1) or later (+1) as a group: the block of pages
 * goes before the page in front of the first one, or after the page behind the last one.
 */
export function movePagesBy(
  pages: readonly PageItem[],
  ids: ReadonlySet<number>,
  step: -1 | 1,
): PageItem[] {
  const positions = pages.flatMap((p, i) => (ids.has(p.id) ? [i] : []));
  const first = positions[0];
  const last = positions.at(-1);
  if (first === undefined || last === undefined) return [...pages];
  if (step === -1) return first === 0 ? [...pages] : movePagesBefore(pages, ids, first - 1);
  return last === pages.length - 1 ? [...pages] : movePagesBefore(pages, ids, last + 2);
}

/** Ids from `fromId` to `toId` in the current order (both included). */
export function rangeIds(pages: readonly PageItem[], fromId: number, toId: number): number[] {
  const a = pages.findIndex((p) => p.id === fromId);
  const b = pages.findIndex((p) => p.id === toId);
  if (b < 0) return [];
  if (a < 0) return [toId];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return pages.slice(lo, hi + 1).map((p) => p.id);
}

/** The selected ids that still exist, in page order. */
export function selectedInOrder(
  pages: readonly PageItem[],
  selected: ReadonlySet<number>,
): number[] {
  return pages.flatMap((p) => (selected.has(p.id) ? [p.id] : []));
}

export function toOrganizePages(pages: readonly PageItem[]): OrganizeInput['pages'] {
  return pages.map((p) => ({ index: p.id, rotate: p.rotate }));
}
