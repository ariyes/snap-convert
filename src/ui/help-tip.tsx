import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { strings } from './strings';

/** Space kept between the bubble and the edge of the screen. */
const EDGE = 12;

export interface HelpTipProps {
  /** The help text. Shown in the bubble and read by screen readers as the button's description. */
  children: string;
  /** Accessible name of the (i) button, e.g. "About quality". Default "More info". */
  label?: string;
  className?: string;
}

/**
 * Prototype `.tip`: a small (i) button. The text shows on hover, keyboard focus or tap,
 * closes on Escape, and is moved sideways (or below) so it stays on screen near the edges.
 */
export function HelpTip({ children, label = strings.helpTipLabel, className }: HelpTipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const hovered = useRef(false);

  // Escape or a tap elsewhere closes the bubble.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Keep the bubble on screen: shift it sideways, and show it below the button if there's no room above.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!open || !bubble) return;
    bubble.style.translate = '';
    bubble.dataset.side = 'top';
    let rect = bubble.getBoundingClientRect();
    if (rect.top < EDGE) {
      bubble.dataset.side = 'bottom';
      rect = bubble.getBoundingClientRect();
    }
    const viewport = document.documentElement.clientWidth;
    let shift = 0;
    if (rect.right > viewport - EDGE) shift = viewport - EDGE - rect.right;
    if (rect.left + shift < EDGE) shift = EDGE - rect.left;
    if (shift !== 0) bubble.style.translate = `${Math.round(shift)}px 0`;
  }, [open]);

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    hovered.current = true;
    setOpen(true);
  };
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    hovered.current = false;
    if (document.activeElement !== buttonRef.current) setOpen(false);
  };

  return (
    <span className={cn('relative ml-1 inline-flex align-[1px]', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={id}
        className={cn(
          'grid size-4 cursor-help place-items-center rounded-full border border-faint bg-transparent p-0',
          'font-mono text-[10px] leading-none font-semibold text-faint',
          'hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent',
          open && 'border-accent text-accent',
        )}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!hovered.current) setOpen(false);
        }}
        onClick={(event) => {
          // Inside a <label>: don't toggle the labelled control. On touch: a tap opens the tip.
          event.preventDefault();
          setOpen(true);
        }}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        i
      </button>
      <span
        ref={bubbleRef}
        id={id}
        role="tooltip"
        hidden={!open}
        className={cn(
          'pointer-events-none absolute -left-2 z-30 w-max max-w-[min(240px,70vw)]',
          'rounded-lg bg-fg px-2.5 py-2 text-left font-sans text-xs leading-[1.45] font-normal whitespace-normal text-bg normal-case shadow-card',
          'bottom-[calc(100%+8px)] data-[side=bottom]:top-[calc(100%+8px)] data-[side=bottom]:bottom-auto',
        )}
      >
        {children}
      </span>
    </span>
  );
}
