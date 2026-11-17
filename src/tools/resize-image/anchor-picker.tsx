import * as RadioGroup from '@radix-ui/react-radio-group';
import type { Anchor } from '@/core/contracts/sizing';
import { cn } from '@/lib/utils';
import { HelpTip } from '@/ui';
import { ANCHORS } from './settings';
import { resizeStrings as strings } from './strings';

export interface AnchorPickerProps {
  value: Anchor;
  onChange: (anchor: Anchor) => void;
  className?: string;
}

/** IMG-03 crop anchor for Fill: a 3 × 3 grid of positions; the chosen part of the image is kept. */
export function AnchorPicker({ value, onChange, className }: AnchorPickerProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="text-ui font-medium text-muted">
        {strings.anchorTitle}
        <HelpTip label={strings.anchorTipLabel}>{strings.anchorTip}</HelpTip>
      </span>
      <RadioGroup.Root
        aria-label={strings.anchorGroup}
        value={value}
        onValueChange={(next) => {
          const match = ANCHORS.find((a) => a === next);
          if (match) onChange(match);
        }}
        className="grid shrink-0 grid-cols-3 gap-1 rounded-lg border border-line bg-sunk p-1"
      >
        {ANCHORS.map((anchor) => (
          <RadioGroup.Item
            key={anchor}
            value={anchor}
            aria-label={strings.anchors[anchor]}
            title={strings.anchors[anchor]}
            className={cn(
              'grid size-6 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0',
              'hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            )}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-faint/50 in-data-[state=checked]:size-3 in-data-[state=checked]:bg-accent"
            />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
