import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { rowOffsets, visibleRange, WindowedList } from './windowed-list';

describe('rowOffsets', () => {
  it('adds up row heights', () => {
    expect([...rowOffsets([10, 20, 30])]).toEqual([0, 10, 30, 60]);
    expect([...rowOffsets([])]).toEqual([0]);
  });
});

describe('visibleRange', () => {
  const offsets = rowOffsets(Array.from({ length: 1000 }, () => 50));

  it('finds the rows that overlap the window', () => {
    expect(visibleRange(offsets, 0, 200)).toEqual({ start: 0, end: 4 });
    expect(visibleRange(offsets, 1010, 1100)).toEqual({ start: 20, end: 22 });
  });

  it('clamps above and below the list', () => {
    expect(visibleRange(offsets, -500, -100)).toEqual({ start: 0, end: 1 });
    expect(visibleRange(offsets, 60_000, 61_000)).toEqual({ start: 999, end: 1000 });
  });

  it('handles an empty list', () => {
    expect(visibleRange(rowOffsets([]), 0, 100)).toEqual({ start: 0, end: 0 });
  });
});

describe('WindowedList', () => {
  afterEach(cleanup);
  const items = (n: number) => Array.from({ length: n }, (_, i) => `item-${i + 1}`);
  const renderList = (n: number) =>
    render(
      <WindowedList
        aria-label="Files"
        items={items(n)}
        getKey={(s) => s}
        renderItem={(s) => <span>{s}</span>}
        estimateHeight={50}
      />,
    );

  it('renders every row up to 200', () => {
    renderList(200);
    const list = screen.getByRole('list', { name: 'Files' });
    expect(list.dataset.windowed).toBeUndefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(200);
  });

  it('renders only the rows near the screen above 200', () => {
    renderList(1000);
    const list = screen.getByRole('list', { name: 'Files' });
    expect(list.dataset.windowed).toBe('true');
    expect(list.style.height).toBe('50000px');
    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]?.getAttribute('aria-setsize')).toBe('1000');
    expect(rows[0]?.getAttribute('aria-posinset')).toBe('1');
  });
});
