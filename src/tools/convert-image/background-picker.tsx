import { useId } from 'react';
import { Field } from '@/features/tool-layout';
import { cn } from '@/lib/utils';
import { HelpTip, Swatches, type SwatchOption } from '@/ui';
import { convertStrings as strings } from './strings';

/** Background colours offered first. These are output colours (data), not theme colours. */
const BACKGROUNDS: ReadonlyArray<SwatchOption> = [
  { value: '#ffffff', label: strings.backgroundNames.white },
  { value: '#000000', label: strings.backgroundNames.black },
  { value: '#f3f2f0', label: strings.backgroundNames.lightGrey },
];

export interface BackgroundPickerProps {
  value: string;
  onChange: (background: string) => void;
  className?: string;
}

/** IMG-01: the colour behind transparent areas when saving as JPG (default white), or any colour. */
export function BackgroundPicker({ value, onChange, className }: BackgroundPickerProps) {
  const id = useId();
  const preset = BACKGROUNDS.some((b) => b.value === value.toLowerCase());
  return (
    <Field className={className}>
      <span className="text-ui font-medium text-muted">
        {strings.background}
        <HelpTip label={strings.backgroundTipLabel}>{strings.backgroundTip}</HelpTip>
      </span>
      <div className="flex items-center gap-1.5">
        <Swatches
          label={strings.background}
          options={BACKGROUNDS}
          value={preset ? value.toLowerCase() : ''}
          onValueChange={onChange}
        />
        <label
          htmlFor={id}
          title={strings.customColour}
          className={cn(
            'relative size-7 cursor-pointer overflow-hidden rounded-lg border border-line',
            'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
            !preset && 'outline-2 outline-offset-2 outline-accent',
          )}
          // A rainbow until a custom colour is picked; then that colour (data, not a theme colour).
          style={{
            background: preset
              ? 'conic-gradient(#ef4444, #eab308, #22c55e, #3b82f6, #a855f7, #ef4444)'
              : value,
          }}
        >
          <span className="sr-only">{strings.customColour}</span>
          <input
            id={id}
            type="color"
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </Field>
  );
}
