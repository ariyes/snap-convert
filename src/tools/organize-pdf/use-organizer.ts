// Page list + selection for Organize pages. Every page edit goes through the undo history;
// selection and focus are not part of it.
import { useCallback, useMemo, useState } from 'react';
import {
  commit,
  createHistory,
  deletePages,
  movePagesBefore,
  movePagesBy,
  movePagesTo,
  rangeIds,
  redo,
  rotatePages,
  undo,
  type History,
  type PageItem,
} from './pages';
import { organizeStrings as t } from './strings';

interface State {
  history: History;
  selected: ReadonlySet<number>;
  /** Where Shift-click and Shift + arrow ranges start. */
  anchor: number | null;
  /** The page that has (or gets) keyboard focus. */
  focus: number | null;
  /** Last change, for screen readers. `n` makes repeated messages announce again. */
  message: { text: string; n: number };
}

export interface Organizer {
  pages: PageItem[];
  selected: ReadonlySet<number>;
  anchor: number | null;
  focus: number | null;
  message: { text: string; n: number };
  canUndo: boolean;
  canRedo: boolean;
  /** Selected pages if any, else the focused page — what the actions apply to. */
  targets: () => Set<number>;
  setFocus: (id: number) => void;
  selectOnly: (id: number) => void;
  toggle: (id: number) => void;
  /** Selects anchor…id. `add` keeps the current selection too. */
  selectRange: (id: number, add?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  rotate: (delta: 90 | -90) => void;
  remove: () => void;
  moveTo: (where: 'start' | 'end') => void;
  moveBy: (step: -1 | 1) => void;
  moveBefore: (ids: ReadonlySet<number>, before: number) => void;
  undo: () => void;
  redo: () => void;
}

function initial(count: number): State {
  return {
    history: createHistory(count),
    selected: new Set(),
    anchor: null,
    focus: count > 0 ? 0 : null,
    message: { text: '', n: 0 },
  };
}

const say = (state: State, text: string) => ({ text, n: state.message.n + 1 });

/** Keeps selection and focus on pages that still exist after an edit, undo or redo. */
function settle(state: State, history: History, text: string): State {
  const ids = new Set(history.present.map((p) => p.id));
  const selected = new Set([...state.selected].filter((id) => ids.has(id)));
  let focus = state.focus !== null && ids.has(state.focus) ? state.focus : null;
  if (focus === null && history.present.length > 0) {
    // Focus the page now where the old focus was (or the last page).
    const old = state.history.present.findIndex((p) => p.id === state.focus);
    const at = Math.min(Math.max(old, 0), history.present.length - 1);
    focus = history.present[at]?.id ?? null;
  }
  return {
    history,
    selected,
    anchor: state.anchor !== null && ids.has(state.anchor) ? state.anchor : focus,
    focus,
    message: say(state, text),
  };
}

function targetsOf(state: State): Set<number> {
  if (state.selected.size > 0) return new Set(state.selected);
  return state.focus === null ? new Set() : new Set([state.focus]);
}

export function useOrganizer(pageCount: number): Organizer {
  const [state, setState] = useState(() => initial(pageCount));

  /** Applies a page edit to the targets as one undo step. */
  const edit = useCallback(
    (change: (pages: PageItem[], ids: Set<number>) => PageItem[], text: (n: number) => string) =>
      setState((s) => {
        const ids = targetsOf(s);
        if (ids.size === 0) return s;
        const history = commit(s.history, change(s.history.present, ids));
        if (history === s.history) return s;
        // Acting on the focused page alone selects it, so the next action follows it.
        const next = s.selected.size > 0 ? s : { ...s, selected: ids };
        return settle(next, history, text(ids.size));
      }),
    [],
  );

  const actions = useMemo(
    () => ({
      setFocus: (id: number) => setState((s) => ({ ...s, focus: id })),
      selectOnly: (id: number) =>
        setState((s) => ({ ...s, selected: new Set([id]), anchor: id, focus: id })),
      toggle: (id: number) =>
        setState((s) => {
          const selected = new Set(s.selected);
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          return { ...s, selected, anchor: id, focus: id };
        }),
      selectRange: (id: number, add = false) =>
        setState((s) => {
          const range = rangeIds(s.history.present, s.anchor ?? id, id);
          const selected = new Set(add ? [...s.selected, ...range] : range);
          return { ...s, selected, focus: id, anchor: s.anchor ?? id };
        }),
      selectAll: () =>
        setState((s) => ({ ...s, selected: new Set(s.history.present.map((p) => p.id)) })),
      clearSelection: () => setState((s) => ({ ...s, selected: new Set() })),
      rotate: (delta: 90 | -90) =>
        edit((pages, ids) => rotatePages(pages, ids, delta), t.announceRotated),
      remove: () =>
        setState((s) => {
          const ids = targetsOf(s);
          if (ids.size === 0) return s;
          const history = commit(s.history, deletePages(s.history.present, ids));
          return settle({ ...s, selected: new Set() }, history, t.announceDeleted(ids.size));
        }),
      moveTo: (where: 'start' | 'end') =>
        edit((pages, ids) => movePagesTo(pages, ids, where), t.announceMoved),
      moveBy: (step: -1 | 1) =>
        edit((pages, ids) => movePagesBy(pages, ids, step), t.announceMoved),
      moveBefore: (ids: ReadonlySet<number>, before: number) =>
        setState((s) => {
          const history = commit(s.history, movePagesBefore(s.history.present, ids, before));
          if (history === s.history) return s;
          return settle({ ...s, selected: new Set(ids) }, history, t.announceMoved(ids.size));
        }),
      undo: () =>
        setState((s) => {
          const history = undo(s.history);
          if (history === s.history) return { ...s, message: say(s, t.announceNothingToUndo) };
          return settle(s, history, t.announceUndo);
        }),
      redo: () =>
        setState((s) => {
          const history = redo(s.history);
          if (history === s.history) return { ...s, message: say(s, t.announceNothingToRedo) };
          return settle(s, history, t.announceRedo);
        }),
    }),
    [edit],
  );

  return {
    ...actions,
    pages: state.history.present,
    selected: state.selected,
    anchor: state.anchor,
    focus: state.focus,
    message: state.message,
    canUndo: state.history.past.length > 0,
    canRedo: state.history.future.length > 0,
    targets: () => targetsOf(state),
  };
}
