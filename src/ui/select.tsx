import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { inputClass } from './input';
import { strings } from './strings';

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  options: ReadonlyArray<SelectOption<T>>;
  value: T | undefined;
  onValueChange: (value: T) => void;
  /** Links a visible <label htmlFor={id}>. */
  id?: string;
  /** Accessible name when there's no visible label. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Prototype `select.input`, built on Radix Select so the list matches the theme. */
export function Select<T extends string>({
  options,
  value,
  onValueChange,
  id,
  placeholder = strings.selectPlaceholder,
  disabled,
  className,
  ...aria
}: SelectProps<T>) {
  return (
    <RadixSelect.Root
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onValueChange(option.value);
      }}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        id={id}
        {...aria}
        className={cn(
          inputClass,
          'flex cursor-pointer items-center justify-between gap-2 text-left',
          'data-[placeholder]:text-faint',
          className,
        )}
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className="text-faint">
          <ChevronDown aria-hidden="true" className="size-4" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden',
            'rounded-control border border-line bg-card text-fg shadow-card',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex h-9 cursor-pointer items-center rounded-lg pr-8 pl-2.5 text-sm outline-none select-none',
                  'data-[highlighted]:bg-sunk data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
                )}
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2.5 inline-flex text-accent">
                  <Check aria-hidden="true" className="size-4" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
