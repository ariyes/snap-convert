import * as RadioGroup from '@radix-ui/react-radio-group';
import {
  Globe,
  ImageIcon,
  LayoutGrid,
  Mail,
  Newspaper,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import { useId } from 'react';
import { WEB_PRESETS, type PresetId } from '@/engines/optimize';
import { cn } from '@/lib/utils';
import type { WebFormat } from './settings';
import { optimizeStrings as t } from './strings';

const ICONS: Record<PresetId, LucideIcon> = {
  web: Globe,
  wordpress: Newspaper,
  shopify: ShoppingBag,
  blog: ImageIcon,
  email: Mail,
  thumbnail: LayoutGrid,
};

export interface DestinationPickerProps {
  value: PresetId;
  format: WebFormat;
  onChange: (destination: PresetId) => void;
  disabled?: boolean;
}

/** Large cards for where the images go, each with its size and format (sizes from P12's presets). */
export function DestinationPicker({ value, format, onChange, disabled }: DestinationPickerProps) {
  const id = useId();
  return (
    <RadioGroup.Root
      aria-label={t.destinationLabel}
      value={value}
      onValueChange={(next) => {
        const preset = WEB_PRESETS.find((p) => p.id === next);
        if (preset) onChange(preset.id);
      }}
      disabled={disabled}
      className="grid grid-cols-2 gap-2"
    >
      {WEB_PRESETS.map((preset) => {
        const Icon = ICONS[preset.id];
        const titleId = `${id}-${preset.id}-title`;
        const specId = `${id}-${preset.id}-spec`;
        return (
          <RadioGroup.Item
            key={preset.id}
            value={preset.id}
            aria-labelledby={titleId}
            aria-describedby={specId}
            data-testid={`destination-${preset.id}`}
            className={cn(
              'flex min-h-[68px] min-w-0 cursor-pointer flex-col items-start gap-1 rounded-control border border-line bg-transparent px-3 py-2.5 text-left text-fg',
              'hover:border-faint disabled:cursor-not-allowed disabled:opacity-45',
              'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft',
            )}
          >
            <span className="flex w-full min-w-0 items-start gap-1.5">
              <Icon
                aria-hidden="true"
                className="mt-px size-4 shrink-0 text-muted in-data-[state=checked]:text-accent"
              />
              <span id={titleId} className="min-w-0 text-ui leading-snug font-semibold">
                {t.destinations[preset.id]}
              </span>
            </span>
            <span id={specId} className="text-xs text-muted tabular-nums">
              {t.destinationSpec(preset.longestSide, format)}
            </span>
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
