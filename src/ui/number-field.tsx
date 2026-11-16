import { useId, useState, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { inputClass } from './input';

/** Keeps `value` within `min`–`max`. */
export function clamp(value: number, min = -Infinity, max = Infinity): number {
  return Math.min(max, Math.max(min, value));
}

export interface NumberFieldProps extends Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step'
> {
  value: number;
  /** Called with a number already clamped to min–max. */
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown inside the field on the right, e.g. "px", "%", "KB". */
  unit?: string;
  /** Allow decimals (default: whole numbers only). */
  decimals?: boolean;
}

/**
 * Prototype `.input-wrap` with a unit suffix. Typing updates the value live while it's within
 * min–max; leaving the field (or Enter) clamps anything outside and restores an empty field.
 */
export function NumberField({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  unit,
  decimals = false,
  className,
  onBlur,
  onKeyDown,
  'aria-describedby': describedBy,
  ...props
}: NumberFieldProps) {
  const unitId = useId();
  const [draft, setDraft] = useState(String(value));
  const [shownValue, setShownValue] = useState(value);
  // The value changed from outside (e.g. Reset): show it.
  if (value !== shownValue) {
    setShownValue(value);
    setDraft(String(value));
  }

  const parse = (text: string): number | null => {
    if (text.trim() === '') return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return decimals ? n : Math.round(n);
  };

  const commit = () => {
    const parsed = parse(draft);
    const next = parsed === null ? value : clamp(parsed, min, max);
    setDraft(String(next));
    setShownValue(next);
    if (next !== value) onValueChange(next);
  };

  return (
    <div className={cn('relative flex items-center', className)}>
      <input
        type="number"
        inputMode={decimals ? 'decimal' : 'numeric'}
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-describedby={[describedBy, unit && unitId].filter(Boolean).join(' ') || undefined}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = parse(text);
          if (parsed !== null && parsed === clamp(parsed, min, max) && parsed !== value) {
            setShownValue(parsed);
            onValueChange(parsed);
          }
        }}
        onBlur={(event) => {
          commit();
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          onKeyDown?.(event);
        }}
        className={cn(
          inputClass,
          'tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          unit && 'pr-10',
        )}
        {...props}
      />
      {unit && (
        <span
          id={unitId}
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 text-ui text-faint"
        >
          {unit}
        </span>
      )}
    </div>
  );
}
