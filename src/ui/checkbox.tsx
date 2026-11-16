import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Helper } from './label';

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Text next to the box; clicking it toggles the box. */
  label: ReactNode;
  /** Small text under the label, read as the checkbox's description. */
  helper?: ReactNode;
  /** Shown after the label, e.g. a <HelpTip> (kept outside the <label> so tapping it doesn't toggle). */
  tip?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Prototype `.check`: a checkbox with a label, optional help tip and helper text. */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  helper,
  tip,
  disabled,
  id,
  className,
}: CheckboxProps) {
  const autoId = useId();
  const boxId = id ?? autoId;
  const helperId = `${boxId}-helper`;

  return (
    <div className={cn('flex items-start gap-2.5 text-sm', className)}>
      <RadixCheckbox.Root
        id={boxId}
        checked={checked}
        onCheckedChange={(state) => onCheckedChange(state === true)}
        disabled={disabled}
        aria-describedby={helper ? helperId : undefined}
        className={cn(
          'mt-[3px] grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border border-faint bg-card',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-on-accent',
          'disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        <RadixCheckbox.Indicator>
          <Check aria-hidden="true" className="size-3 stroke-3" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <div className="min-w-0">
        <label
          htmlFor={boxId}
          className={cn('cursor-pointer', disabled && 'cursor-not-allowed opacity-45')}
        >
          {label}
        </label>
        {tip}
        {helper && <Helper id={helperId}>{helper}</Helper>}
      </div>
    </div>
  );
}
