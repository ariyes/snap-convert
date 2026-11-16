import * as RadixSlider from '@radix-ui/react-slider';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Helper } from './label';

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  /** Called once when the user lets go (pointer up or key press). */
  onValueCommit?: (value: number) => void;
  /** Visible label, e.g. "Quality". */
  label: ReactNode;
  /** Accessible name when `label` isn't plain text. */
  ariaLabel?: string;
  /** Shown after the label, e.g. a <HelpTip>. */
  tip?: ReactNode;
  /** Small text under the slider. */
  helper?: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  /** How the value is shown on the right and read by screen readers. */
  formatValue?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

/** Prototype quality slider: label and value on one line, the track below. */
export function Slider({
  value,
  onValueChange,
  onValueCommit,
  label,
  ariaLabel,
  tip,
  helper,
  min = 0,
  max = 100,
  step = 1,
  formatValue = String,
  disabled,
  className,
}: SliderProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const helperId = `${id}-helper`;
  const shown = formatValue(value);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span>
          <span id={labelId} className="text-ui font-medium text-muted">
            {label}
          </span>
          {tip}
        </span>
        <span className="font-mono tabular-nums" aria-hidden="true">
          {shown}
        </span>
      </div>
      <RadixSlider.Root
        value={[value]}
        onValueChange={([next]) => {
          if (next !== undefined) onValueChange(next);
        }}
        onValueCommit={([next]) => {
          if (next !== undefined) onValueCommit?.(next);
        }}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="relative flex h-5 w-full touch-none items-center select-none data-[disabled]:opacity-45"
      >
        <RadixSlider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-line">
          <RadixSlider.Range className="absolute h-full bg-accent" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          aria-labelledby={ariaLabel ? undefined : labelId}
          aria-label={ariaLabel}
          aria-valuetext={shown}
          aria-describedby={helper ? helperId : undefined}
          className="block size-4 cursor-grab rounded-full border-0 bg-accent shadow-raised active:cursor-grabbing"
        />
      </RadixSlider.Root>
      {helper && <Helper id={helperId}>{helper}</Helper>}
    </div>
  );
}
