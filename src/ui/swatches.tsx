import * as RadioGroup from '@radix-ui/react-radio-group';
import { cn } from '@/lib/utils';

export interface SwatchOption {
  /** A CSS colour such as '#ffffff', or 'transparent'. */
  value: string;
  /** Accessible name, e.g. "White". */
  label: string;
}

export interface SwatchesProps {
  options: ReadonlyArray<SwatchOption>;
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name of the group, e.g. "Padding colour". */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Prototype `.swatches`: pick a colour, including a checkerboard "transparent" option. */
export function Swatches({
  options,
  value,
  onValueChange,
  label,
  disabled,
  className,
}: SwatchesProps) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={onValueChange}
      orientation="horizontal"
      disabled={disabled}
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {options.map((option) => {
        const transparent = option.value === 'transparent';
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            aria-label={option.label}
            title={option.label}
            className={cn(
              'size-7 cursor-pointer rounded-lg border border-line p-0',
              'data-[state=checked]:outline-2 data-[state=checked]:outline-offset-2 data-[state=checked]:outline-accent',
              'disabled:cursor-not-allowed disabled:opacity-45',
              transparent && 'bg-checker-light',
            )}
            // The colour is data chosen by the tool (or the user), not a theme colour.
            style={transparent ? undefined : { backgroundColor: option.value }}
          />
        );
      })}
    </RadioGroup.Root>
  );
}
