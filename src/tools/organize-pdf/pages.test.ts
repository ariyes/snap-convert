import { describe, expect, it } from 'vitest';
import {
  commit,
  createHistory,
  deletePages,
  MAX_UNDO,
  movePagesBefore,
  movePagesBy,
  movePagesTo,
  normalize,
  rangeIds,
  redo,
  rotatePages,
  selectedInOrder,
  toOrganizePages,
  undo,
  type PageItem,
} from './pages';

const ids = (pages: PageItem[]) => pages.map((p) => p.id);
const set = (...n: number[]) => new Set(n);
const six = createHistory(6).present;

describe('page edits', () => {
  it('rotates only the chosen pages, wrapping around', () => {
    const turned = rotatePages(six, set(1, 3), 90);
    expect(turned.map((p) => p.rotate)).toEqual([0, 90, 0, 90, 0, 0]);
    expect(rotatePages(turned, set(1), -180).map((p) => p.rotate)).toEqual([0, 270, 0, 90, 0, 0]);
    expect(normalize(-90)).toBe(270);
    expect(normalize(450)).toBe(90);
  });

  it('deletes pages', () => {
    expect(ids(deletePages(six, set(0, 5)))).toEqual([1, 2, 3, 4]);
  });

  it('moves a group before a position, keeping its order', () => {
    expect(ids(movePagesBefore(six, set(4, 1), 0))).toEqual([1, 4, 0, 2, 3, 5]);
    expect(ids(movePagesBefore(six, set(0, 1), 4))).toEqual([2, 3, 0, 1, 4, 5]);
    expect(ids(movePagesBefore(six, set(0), 6))).toEqual([1, 2, 3, 4, 5, 0]);
    // Dropping a page on its own place changes nothing.
    expect(ids(movePagesBefore(six, set(2), 2))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ids(movePagesBefore(six, set(2), 3))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('moves to the start or end', () => {
    expect(ids(movePagesTo(six, set(3, 5), 'start'))).toEqual([3, 5, 0, 1, 2, 4]);
    expect(ids(movePagesTo(six, set(0, 2), 'end'))).toEqual([1, 3, 4, 5, 0, 2]);
  });

  it('moves one step earlier or later and stops at the ends', () => {
    expect(ids(movePagesBy(six, set(2, 3), -1))).toEqual([0, 2, 3, 1, 4, 5]);
    expect(ids(movePagesBy(six, set(2, 3), 1))).toEqual([0, 1, 4, 2, 3, 5]);
    expect(ids(movePagesBy(six, set(0), -1))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ids(movePagesBy(six, set(5), 1))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('finds ranges and selected pages in the current order', () => {
    const order = movePagesTo(six, set(5), 'start'); // 5 0 1 2 3 4
    expect(rangeIds(order, 1, 5)).toEqual([5, 0, 1]);
    expect(rangeIds(order, 3, 0)).toEqual([0, 1, 2, 3]);
    expect(rangeIds(order, 99, 2)).toEqual([2]);
    expect(selectedInOrder(order, set(2, 5, 42))).toEqual([5, 2]);
  });

  it('builds the organize input', () => {
    const pages = rotatePages(deletePages(movePagesTo(six, set(4), 'start'), set(0)), set(4), 270);
    expect(toOrganizePages(pages)).toEqual([
      { index: 4, rotate: 270 },
      { index: 1, rotate: 0 },
      { index: 2, rotate: 0 },
      { index: 3, rotate: 0 },
      { index: 5, rotate: 0 },
    ]);
  });
});

describe('undo and redo', () => {
  it('restores every step', () => {
    let h = createHistory(4);
    const steps = [h.present];
    h = commit(h, rotatePages(h.present, set(0), 90));
    steps.push(h.present);
    h = commit(h, deletePages(h.present, set(2)));
    steps.push(h.present);
    h = commit(h, movePagesTo(h.present, set(3), 'start'));
    steps.push(h.present);

    for (let i = steps.length - 2; i >= 0; i--) {
      h = undo(h);
      expect(h.present).toEqual(steps[i]);
    }
    expect(undo(h)).toBe(h);
    for (let i = 1; i < steps.length; i++) {
      h = redo(h);
      expect(h.present).toEqual(steps[i]);
    }
    expect(redo(h)).toBe(h);
  });

  it('ignores edits that change nothing and clears redo on a new edit', () => {
    let h = createHistory(3);
    expect(commit(h, [...h.present])).toBe(h);
    h = commit(h, deletePages(h.present, set(0)));
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = commit(h, rotatePages(h.present, set(1), 90));
    expect(h.future).toHaveLength(0);
  });

  it('keeps at most MAX_UNDO steps', () => {
    let h = createHistory(2);
    for (let i = 0; i < MAX_UNDO + 20; i++) h = commit(h, rotatePages(h.present, set(0), 90));
    expect(h.past).toHaveLength(MAX_UNDO);
  });
});
