import { CircleCheck, RotateCw } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Size } from '@/core/sizing';
import { cn } from '@/lib/utils';
import { PageThumb } from './page-thumb';
import { selectedInOrder } from './pages';
import { organizeStrings as t } from './strings';
import type { Organizer } from './use-organizer';

/** Press and hold this long on a touch screen to select a page. */
export const LONG_PRESS_MS = 500;
/** A mouse drag starts after moving this far (px). */
const DRAG_START_PX = 5;
/** A touch that moves this far before the long press is a scroll, not a press. */
const TOUCH_SLOP_PX = 10;
/** Near the top or bottom edge of the window, a drag scrolls the page. */
const EDGE_PX = 60;
const EDGE_SCROLL_PX = 14;

interface Press {
  pointerId: number;
  id: number;
  touch: boolean;
  x: number;
  y: number;
  /** Long press fired (touch). */
  held: boolean;
  /** Pages being dragged once the drag has started. */
  dragging: number[] | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface DragView {
  ids: ReadonlySet<number>;
  /** Insert position (0 … page count). */
  before: number;
  x: number;
  y: number;
}

export interface PageGridProps {
  file: Blob;
  organizer: Organizer;
  /** Displayed page sizes by original index (readPdfInfo). */
  sizes: readonly Size[];
  /** While saving: no edits. */
  disabled?: boolean;
}

/** Where a drop at (x, y) would insert, given the tiles' boxes in page order. */
export function insertPosition(rects: readonly DOMRect[], x: number, y: number): number {
  let best = -1;
  let bestScore = Infinity;
  for (const [i, r] of rects.entries()) {
    // Tiles in the pointer's row win; then the nearest one across.
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const cx = r.left + r.width / 2;
    const score = dy * 10_000 + Math.abs(x - cx);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  const r = rects[best];
  if (!r) return 0;
  return x < r.left + r.width / 2 ? best : best + 1;
}

/**
 * The page grid (prototype Merge PDF grid): pick pages with click, Ctrl/⌘-click, Shift-click,
 * long-press on touch, or the keyboard; drag to reorder. A listbox with several selectable options.
 */
export function PageGrid({ file, organizer, sizes, disabled = false }: PageGridProps) {
  const { pages, selected, focus } = organizer;
  const gridRef = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<number, HTMLDivElement>());
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  /** After a long press, taps add or remove pages until nothing is selected. */
  const [touchMode, setTouchMode] = useState(false);
  const picking = touchMode && selected.size > 0;

  /** Keyboard focus is in the grid (stays true when the focused page is deleted). */
  const hasFocus = useRef(false);

  // Move keyboard focus with the focused page, only while focus is in the grid.
  useEffect(() => {
    const grid = gridRef.current;
    const active = document.activeElement;
    const lost = hasFocus.current && (active === null || active === document.body);
    if (focus === null || !grid || (!grid.contains(active) && !lost)) return;
    const el = tiles.current.get(focus);
    if (el && el !== document.activeElement) el.focus();
  }, [focus, pages]);

  // While a held touch drags a page, stop the page from scrolling instead.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const block = (e: TouchEvent) => {
      if (press.current?.held) e.preventDefault();
    };
    grid.addEventListener('touchmove', block, { passive: false });
    return () => grid.removeEventListener('touchmove', block);
  }, []);

  // Stop a pending long press when the grid goes away.
  useEffect(
    () => () => {
      const p = press.current;
      if (p?.timer) clearTimeout(p.timer);
    },
    [],
  );

  const rects = () =>
    pages.map((p) => tiles.current.get(p.id)?.getBoundingClientRect() ?? new DOMRect());

  const endPress = () => {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    press.current = null;
    setDrag(null);
  };

  const startDrag = (p: Press) => {
    p.dragging = selected.has(p.id) ? selectedInOrder(pages, selected) : [p.id];
    if (!selected.has(p.id)) organizer.selectOnly(p.id);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: number) => {
    if (disabled || e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    if (press.current?.timer) clearTimeout(press.current.timer);
    const p: Press = {
      pointerId: e.pointerId,
      id,
      touch,
      x: e.clientX,
      y: e.clientY,
      held: false,
      dragging: null,
      timer: null,
    };
    press.current = p;

    if (touch) {
      p.timer = setTimeout(() => {
        p.timer = null;
        p.held = true;
        organizer.toggle(id);
        setTouchMode(true);
      }, LONG_PRESS_MS);
      return;
    }

    if (e.shiftKey) {
      organizer.selectRange(id, e.ctrlKey || e.metaKey);
      press.current = null;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      organizer.toggle(id);
      press.current = null;
      return;
    }
    if (!selected.has(id)) organizer.selectOnly(id);
    else organizer.setFocus(id);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const distance = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (!p.dragging) {
      if (p.touch && !p.held) {
        if (distance > TOUCH_SLOP_PX) endPress(); // a scroll
        return;
      }
      if (distance <= (p.touch ? TOUCH_SLOP_PX : DRAG_START_PX)) return;
      startDrag(p);
    }
    const ids = new Set(p.dragging);
    setDrag({
      ids,
      before: insertPosition(rects(), e.clientX, e.clientY),
      x: e.clientX,
      y: e.clientY,
    });
    if (e.clientY < EDGE_PX) window.scrollBy(0, -EDGE_SCROLL_PX);
    else if (e.clientY > window.innerHeight - EDGE_PX) window.scrollBy(0, EDGE_SCROLL_PX);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (p.dragging) {
      organizer.moveBefore(new Set(p.dragging), insertPosition(rects(), e.clientX, e.clientY));
    } else if (p.touch) {
      if (!p.held) {
        if (picking) organizer.toggle(p.id);
        else {
          organizer.selectOnly(p.id);
          setTouchMode(false);
        }
      }
    } else {
      organizer.selectOnly(p.id);
    }
    endPress();
  };

  const columns = () => {
    const els = pages.map((p) => tiles.current.get(p.id)).filter((el) => el !== undefined);
    const top = els[0]?.offsetTop;
    return Math.max(1, els.filter((el) => el.offsetTop === top).length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || pages.length === 0) return;
    const mod = e.ctrlKey || e.metaKey;
    const at = Math.max(
      0,
      pages.findIndex((p) => p.id === focus),
    );
    const current = pages[at]?.id;
    if (current === undefined) return;

    const go = (index: number) => {
      const target = pages[Math.max(0, Math.min(pages.length - 1, index))];
      if (!target) return;
      e.preventDefault();
      if (e.shiftKey) organizer.selectRange(target.id, mod);
      else organizer.setFocus(target.id);
    };

    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
      e.preventDefault();
      organizer.moveBy(-1);
      return;
    }
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      e.preventDefault();
      organizer.moveBy(1);
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
        return go(at - 1);
      case 'ArrowRight':
        return go(at + 1);
      case 'ArrowUp':
        return go(at - columns());
      case 'ArrowDown':
        return go(at + columns());
      case 'Home':
        return go(0);
      case 'End':
        return go(pages.length - 1);
      case ' ':
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) organizer.selectRange(current, mod);
        else if (e.key === 'Enter' && !mod) organizer.selectOnly(current);
        else organizer.toggle(current);
        return;
      case 'Escape':
        if (selected.size > 0) {
          e.preventDefault();
          organizer.clearSelection();
        }
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        organizer.remove();
        return;
      default:
        if (mod && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          organizer.selectAll();
        }
    }
  };

  const focusId = focus ?? pages[0]?.id;

  return (
    <>
      <div
        ref={gridRef}
        role="listbox"
        aria-multiselectable="true"
        tabIndex={-1}
        aria-label={t.gridLabel}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onFocus={() => {
          hasFocus.current = true;
        }}
        onBlur={(e) => {
          // Focus moved somewhere else on the page (not just a deleted page losing it).
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
            hasFocus.current = false;
        }}
        className="grid grid-cols-2 gap-3 p-3.5 min-[560px]:grid-cols-3 min-[1000px]:grid-cols-4"
      >
        {pages.map((page, position) => {
          const isSelected = selected.has(page.id);
          const size = sizes[page.id] ?? { width: 612, height: 792 };
          const lifted = drag?.ids.has(page.id) ?? false;
          return (
            <div
              key={page.id}
              ref={(el) => {
                if (el) tiles.current.set(page.id, el);
                else tiles.current.delete(page.id);
              }}
              role="option"
              aria-selected={isSelected}
              tabIndex={page.id === focusId ? 0 : -1}
              data-page={page.id + 1}
              data-rotate={page.rotate}
              onPointerDown={(e) => onPointerDown(e, page.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={endPress}
              onLostPointerCapture={(e) => {
                if (press.current?.pointerId === e.pointerId && !press.current.touch) endPress();
              }}
              onContextMenu={(e) => e.preventDefault()}
              onFocus={() => {
                if (focus !== page.id) organizer.setFocus(page.id);
              }}
              className={cn(
                'relative flex cursor-grab touch-manipulation flex-col gap-2 rounded-[10px] border border-line bg-card p-2.5 select-none [-webkit-touch-callout:none]',
                'transition-[border-color,opacity,background-color] duration-150 hover:border-faint',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                isSelected && 'border-accent bg-accent-soft hover:border-accent',
                lifted && 'opacity-40',
                disabled && 'cursor-default',
              )}
            >
              {drag?.before === position && <DropMarker side="left" />}
              {drag?.before === pages.length && position === pages.length - 1 && (
                <DropMarker side="right" />
              )}
              <span
                aria-hidden="true"
                className="absolute top-1.5 left-1.5 z-[1] grid h-[22px] min-w-[22px] place-items-center rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent"
              >
                {position + 1}
              </span>
              {isSelected && (
                <CircleCheck
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 z-[1] size-5 rounded-full bg-card text-accent"
                />
              )}
              <PageThumb file={file} index={page.id} size={size} rotate={page.rotate} />
              <div className="flex items-center justify-between gap-1.5 text-xs text-muted">
                <span className="truncate font-medium text-fg">
                  {t.pageCaption(page.id + 1)}
                  <span className="sr-only">{t.pageDetails(position + 1, page.rotate)}</span>
                </span>
                {page.rotate !== 0 && (
                  <span aria-hidden="true" className="inline-flex items-center gap-1 font-mono">
                    <RotateCw aria-hidden="true" className="size-3" />
                    {t.turned(page.rotate)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {drag && (
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-on-accent shadow-card"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          {t.dragCount(drag.ids.size)}
        </span>
      )}
    </>
  );
}

function DropMarker({ side }: { side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden="true"
      data-testid="drop-marker"
      className={cn(
        'absolute inset-y-0 w-[3px] rounded-full bg-accent',
        side === 'left' ? '-left-[7.5px]' : '-right-[7.5px]',
      )}
    />
  );
}
