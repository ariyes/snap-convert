import * as RadioGroup from '@radix-ui/react-radio-group';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** 2–4 options. */
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Compression mode". */
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Prototype `.seg`: a 2–4 option switch. A radio group underneath: arrow keys move and select,
 * and one option is always selected.
 */
export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  label,
  disabled,
  className,
}: SegmentedProps<T>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onValueChange(option.value);
      }}
      orientation="horizontal"
      disabled={disabled}
      className={cn('flex gap-0.5 rounded-control bg-sunk p-[3px]', className)}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            'h-8 min-w-0 flex-1 cursor-pointer rounded-lg border-0 bg-transparent px-2 text-ui font-medium whitespace-nowrap text-muted',
            'hover:text-fg disabled:cursor-not-allowed disabled:opacity-45',
            'data-[state=checked]:bg-card data-[state=checked]:text-fg data-[state=checked]:shadow-raised',
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
