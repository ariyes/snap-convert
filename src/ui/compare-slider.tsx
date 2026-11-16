import { ChevronsLeftRight } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { strings } from './strings';

export interface CompareSliderProps {
  /** Left side, usually <img src={original} alt="" />. Fills the frame with object-fit: contain. */
  before: ReactNode;
  /** Right side, usually the processed image. */
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
  /** Accessible name of the slider. */
  label?: string;
  /** Where the split is, 0–100 (% from the left). Pass with onSplitChange to control it. */
  split?: number;
  defaultSplit?: number;
  onSplitChange?: (split: number) => void;
  /** Width / height of the images, so the frame has their shape. Default 3 / 2. */
  aspectRatio?: number;
  className?: string;
}

const STEP = 1;
const BIG_STEP = 10;

function clampSplit(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/**
 * Prototype `.compare`: before/after with a draggable divider.
 * Keyboard: ←/→ move 1 %, Shift+arrow or PageUp/PageDown 10 %, Home/End to the edges.
 */
export function CompareSlider({
  before,
  after,
  beforeLabel = strings.compareBefore,
  afterLabel = strings.compareAfter,
  label = strings.compareLabel,
  split: controlledSplit,
  defaultSplit = 50,
  onSplitChange,
  aspectRatio = 3 / 2,
  className,
}: CompareSliderProps) {
  const [ownSplit, setOwnSplit] = useState(defaultSplit);
  const split = clampSplit(controlledSplit ?? ownSplit);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (next: number) => {
    const value = clampSplit(next);
    if (value === split) return;
    if (controlledSplit === undefined) setOwnSplit(value);
    onSplitChange?.(value);
  };

  const fromPointer = (event: PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    update(((event.clientX - rect.left) / rect.width) * 100);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const moves: Record<string, number> = {
      ArrowLeft: split - step,
      ArrowDown: split - step,
      ArrowRight: split + step,
      ArrowUp: split + step,
      PageDown: split - BIG_STEP,
      PageUp: split + BIG_STEP,
      Home: 0,
      End: 100,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    update(next);
  };

  return (
    <div
      ref={frameRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={split}
      aria-valuetext={strings.compareValueText(Math.round(split))}
      className={cn(
        'relative w-full cursor-ew-resize touch-pan-y overflow-hidden rounded-control bg-checker select-none',
        '[&_canvas]:pointer-events-none [&_canvas]:absolute [&_canvas]:inset-0 [&_canvas]:size-full [&_canvas]:object-contain',
        '[&_img]:pointer-events-none [&_img]:absolute [&_img]:inset-0 [&_img]:size-full [&_img]:object-contain',
        className,
      )}
      style={{ aspectRatio }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        fromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) fromPointer(event);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <div className="absolute inset-0">{before}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
        {after}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-px bg-handle shadow-handle-line"
        style={{ left: `${split}%` }}
      >
        <span className="absolute top-1/2 left-1/2 grid size-[34px] -translate-1/2 place-items-center rounded-full bg-handle text-on-handle shadow-handle">
          <ChevronsLeftRight className="size-[18px]" />
        </span>
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2.5 left-2.5 rounded-full bg-scrim px-2 py-[3px] text-2xs font-medium text-on-scrim"
      >
        {beforeLabel}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2.5 right-2.5 rounded-full bg-scrim px-2 py-[3px] text-2xs font-medium text-on-scrim"
      >
        {afterLabel}
      </span>
    </div>
  );
}
