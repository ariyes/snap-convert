import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/** Touch: hold this long before the card lifts (a quick swipe still scrolls the page). */
export const LONG_PRESS_MS = 350;
/** Touch: moving further than this before the long press ends counts as scrolling. */
const TOUCH_SLOP = 10;
/** Mouse and pen: the card lifts after moving this far with the button held. */
const MOUSE_SLOP = 4;
/** Near the top or bottom edge of the screen while dragging, the page scrolls. */
const EDGE = 64;
const EDGE_STEP = 14;

export interface ReorderDrag {
  /** Index of the card being dragged. */
  from: number;
  /** Index of the card under the pointer, if any. */
  over: number | null;
  /** How far the pointer has moved since the drag began (CSS px, page scroll included). */
  dx: number;
  dy: number;
}

interface Session {
  end: () => void;
  active: () => boolean;
}

const INTERACTIVE = 'button, a, input, select, textarea, label';

/**
 * Drag to reorder with mouse, pen and touch (pointer events; native drag and drop doesn't work with
 * touch). Mouse and pen drag straight away; touch needs a short hold so swiping still scrolls.
 * Put `containerRef` on the list and spread `itemProps(index)` on each item. Buttons and links
 * inside an item never start a drag.
 */
export function usePointerReorder({
  onMove,
  disabled = false,
}: {
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
}) {
  const [drag, setDrag] = useState<ReorderDrag | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerRef = useCallback((el: HTMLElement | null) => setContainer(el), []);
  const session = useRef<Session | null>(null);
  const latestMove = useRef(onMove);
  useEffect(() => {
    latestMove.current = onMove;
  });

  // While a touch drag is on, stop the page from scrolling. This listener must not be passive and
  // must already be there when the touch starts, so it lives on the list for as long as it exists.
  useEffect(() => {
    const el = container;
    if (!el) return;
    const touchMove = (e: TouchEvent) => {
      if (session.current?.active() && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', touchMove, { passive: false });
    return () => el.removeEventListener('touchmove', touchMove);
  }, [container]);

  // A drag in progress ends when the list goes away.
  useEffect(() => () => session.current?.end(), []);

  function indexAt(x: number, y: number): number | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorder-index]');
    if (!hit || !container?.contains(hit)) return null;
    const index = Number(hit.dataset.reorderIndex);
    return Number.isInteger(index) ? index : null;
  }

  function start(e: ReactPointerEvent<HTMLElement>, index: number) {
    if (disabled || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    session.current?.end();

    const touch = e.pointerType === 'touch';
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const startScrollX = window.scrollX;
    const startScrollY = window.scrollY;
    let active = false;
    let over: number | null = null;
    let last = { x: startX, y: startY };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const offset = () => ({
      dx: last.x - startX + window.scrollX - startScrollX,
      dy: last.y - startY + window.scrollY - startScrollY,
    });
    const begin = () => {
      timer = undefined;
      active = true;
      setDrag({ from: index, over: null, dx: 0, dy: 0 });
    };
    const update = () => {
      over = indexAt(last.x, last.y);
      setDrag({ from: index, over, ...offset() });
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        const distance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (touch) {
          if (distance > TOUCH_SLOP) end();
          return;
        }
        if (distance < MOUSE_SLOP) return;
        begin();
      }
      if (ev.clientY < EDGE) window.scrollBy(0, -EDGE_STEP);
      else if (ev.clientY > window.innerHeight - EDGE) window.scrollBy(0, EDGE_STEP);
      update();
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const target = over;
      const moved = active;
      end();
      if (moved && target !== null && target !== index) latestMove.current(index, target);
    };
    const onPointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end();
    };
    // A long press would otherwise open the context menu on some phones.
    const onContextMenu = (ev: Event) => {
      if (active || timer !== undefined) ev.preventDefault();
    };
    const onScroll = () => {
      if (active) update();
    };

    function end() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      active = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('scroll', onScroll);
      if (session.current === current) session.current = null;
      setDrag(null);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('scroll', onScroll, { passive: true });
    if (touch) timer = setTimeout(begin, LONG_PRESS_MS);
    const current: Session = { end, active: () => active };
    session.current = current;
  }

  const itemProps = (index: number) => ({
    'data-reorder-index': index,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => start(e, index),
  });

  return { drag, containerRef, itemProps };
}
