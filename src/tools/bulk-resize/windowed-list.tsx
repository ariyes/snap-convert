// A small list that only renders the rows near the screen once it gets long (no dependency).
// The page itself scrolls (no inner scroll box), so the list keeps the prototype's look: rows are
// placed absolutely inside a box as tall as the whole list, and each rendered row is measured.
// Rows that were never on screen use the average measured height.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Lists longer than this are windowed. */
export const WINDOW_THRESHOLD = 200;

export interface WindowedListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Height of a row before it's measured, in px. */
  estimateHeight: number;
  /** Rendered beyond the screen, above and below, in px. */
  overscan?: number;
  /** Window above this many rows (default 200). */
  threshold?: number;
  className?: string;
  itemClassName?: string;
  'aria-label'?: string;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Start offsets of every row plus the total height at the end (length n + 1). */
export function rowOffsets(heights: ReadonlyArray<number>): Float64Array {
  const offsets = new Float64Array(heights.length + 1);
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = (offsets[i] ?? 0) + (heights[i] ?? 0);
  return offsets;
}

/** Rows [start, end) that overlap [top, bottom] (list coordinates). Binary search on the offsets. */
export function visibleRange(
  offsets: Float64Array,
  top: number,
  bottom: number,
): { start: number; end: number } {
  const n = offsets.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  // First row whose bottom edge is below `top`.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid + 1] ?? 0) <= top) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.min(lo, n - 1);
  // First row whose top edge is at or below `bottom`.
  lo = start;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid] ?? 0) < bottom) lo = mid + 1;
    else hi = mid;
  }
  return { start, end: Math.max(start + 1, lo) };
}

/** A <ul> that renders every row up to `threshold` rows, and only the rows near the screen above it. */
export function WindowedList<T>(props: WindowedListProps<T>) {
  const { items, threshold = WINDOW_THRESHOLD } = props;
  if (items.length <= threshold) {
    const { getKey, renderItem, className, itemClassName } = props;
    return (
      <ul aria-label={props['aria-label']} className={cn('m-0 list-none p-0', className)}>
        {items.map((item, i) => (
          <li key={getKey(item)} className={itemClassName}>
            {renderItem(item, i)}
          </li>
        ))}
      </ul>
    );
  }
  return <VirtualList {...props} />;
}

function VirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateHeight,
  overscan = 600,
  className,
  itemClassName,
  'aria-label': ariaLabel,
}: WindowedListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  /** Measured heights by row key (kept when rows are removed or reordered). */
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, 30) });

  // Heights and offsets for this render.
  let sum = 0;
  for (const h of heights.values()) sum += h;
  const fallback = heights.size > 0 ? sum / heights.size : estimateHeight;
  const offsets = rowOffsets(items.map((item) => heights.get(getKey(item)) ?? fallback));
  const total = offsets[items.length] ?? 0;

  const offsetsRef = useRef(offsets);

  const update = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const top = -list.getBoundingClientRect().top;
    const next = visibleRange(
      offsetsRef.current,
      top - overscan,
      top + window.innerHeight + overscan,
    );
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [overscan]);

  // After every render: keep the latest offsets for scroll events and check the range.
  useIsoLayoutEffect(() => {
    offsetsRef.current = offsets;
    update();
  });

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [update]);

  // One observer measures every rendered row.
  const observerRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured: Array<[string, number]> = [];
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = el.dataset.key;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height;
        if (key !== undefined && height > 0) measured.push([key, height]);
      }
      if (measured.length === 0) return;
      setHeights((prev) => {
        const changed = measured.some(([key, h]) => Math.abs((prev.get(key) ?? -1) - h) > 0.5);
        return changed ? new Map([...prev, ...measured]) : prev;
      });
    });
    observerRef.current = observer;
    for (const el of listRef.current?.children ?? []) observer.observe(el);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const observe = useCallback((el: HTMLLIElement | null) => {
    if (!el) return;
    observerRef.current?.observe(el);
    return () => observerRef.current?.unobserve(el);
  }, []);

  const end = Math.min(range.end, items.length);
  const start = Math.min(range.start, end);
  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const item = items[i];
    if (item === undefined) continue;
    const key = getKey(item);
    rows.push(
      <li
        key={key}
        ref={observe}
        data-key={key}
        aria-setsize={items.length}
        aria-posinset={i + 1}
        className={cn('absolute inset-x-0', itemClassName)}
        style={{ top: offsets[i] }}
      >
        {renderItem(item, i)}
      </li>,
    );
  }

  return (
    <ul
      ref={listRef}
      aria-label={ariaLabel}
      data-windowed="true"
      className={cn('relative m-0 list-none p-0', className)}
      style={{ height: total }}
    >
      {rows}
    </ul>
  );
}
