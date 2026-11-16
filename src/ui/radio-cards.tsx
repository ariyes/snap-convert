import * as RadioGroup from '@radix-ui/react-radio-group';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface RadioCardOption<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  /** Small picture above the title, e.g. <FitFillPicture mode="fit" />. */
  picture?: ReactNode;
  disabled?: boolean;
}

export interface RadioCardsProps<T extends string> {
  options: ReadonlyArray<RadioCardOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name of the group, e.g. "How to fit". */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Prototype `.fitfill`: option cards with a small picture, a title and a short line. */
export function RadioCards<T extends string>({
  options,
  value,
  onValueChange,
  label,
  disabled,
  className,
}: RadioCardsProps<T>) {
  const id = useId();
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onValueChange(option.value);
      }}
      disabled={disabled}
      className={cn('grid gap-2', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, i) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-labelledby={`${id}-${i}-title`}
          aria-describedby={option.description ? `${id}-${i}-desc` : undefined}
          className={cn(
            'flex min-w-0 cursor-pointer flex-col gap-2 rounded-control border border-line bg-transparent p-2.5 text-left text-ui text-fg',
            'hover:border-faint disabled:cursor-not-allowed disabled:opacity-45',
            'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft',
          )}
        >
          {option.picture}
          <span id={`${id}-${i}-title`} className="font-semibold">
            {option.title}
          </span>
          {option.description && (
            <span id={`${id}-${i}-desc`} className="text-xs text-muted">
              {option.description}
            </span>
          )}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/** The Fit / Fill pictures from the prototype: an accent shape inside a sunk box. */
export function FitFillPicture({ mode, className }: { mode: 'fit' | 'fill'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative grid h-11 w-full place-items-center overflow-hidden rounded-md bg-sunk',
        className,
      )}
    >
      <i
        className={cn('block bg-accent-shape', mode === 'fit' ? 'h-[70%] w-[60%]' : 'size-full')}
      />
    </span>
  );
}
