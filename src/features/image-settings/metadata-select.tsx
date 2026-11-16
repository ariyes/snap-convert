import * as RadioGroup from '@radix-ui/react-radio-group';
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import type { MetadataPolicy, OutputFormat } from '@/core/contracts/image';
import { cn } from '@/lib/utils';
import { Checkbox, HelpTip, Note } from '@/ui';
import { imageSettingsStrings as strings } from './strings';
import { METADATA_POLICIES, type ImageSettingsValues } from './values';

export interface MetadataSelectProps {
  value: Pick<ImageSettingsValues, 'metadata'>;
  onChange: (patch: Pick<ImageSettingsValues, 'metadata'>) => void;
  /** Output format, to tell users that details can only be kept in JPG files. */
  format?: OutputFormat;
  /**
   * Force the "only in JPG files" note on or off. By default it shows when details are kept and
   * `format` is PNG, WebP or AVIF (pass true for "Same as original" with non-JPG files).
   */
  jpegOnlyNote?: boolean;
  /** Show "Smaller file and more private." under the checkbox. Default true. */
  helper?: boolean;
  /** Offer "Keep everything" / "Remove location only" under "More options". Default true. */
  advanced?: boolean;
  className?: string;
}

/**
 * Metadata policy (IMG-11): one checkbox "Remove location and camera details" (on by default),
 * with the finer choices in a "More options" disclosure.
 */
export function MetadataSelect({
  value,
  onChange,
  format,
  jpegOnlyNote,
  helper = true,
  advanced = true,
  className,
}: MetadataSelectProps) {
  const id = useId();
  const policy = value.metadata;
  const [open, setOpen] = useState(policy === 'strip-location');
  const keepsDetails = policy !== 'strip-all';
  const showJpegNote =
    keepsDetails &&
    (jpegOnlyNote ?? (format !== undefined && format !== 'jpeg' && format !== 'keep'));

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <Checkbox
        checked={policy === 'strip-all'}
        onCheckedChange={(strip) => onChange({ metadata: strip ? 'strip-all' : 'keep-all' })}
        label={strings.removeDetails}
        tip={<HelpTip label={strings.metadataTipLabel}>{strings.metadataTip}</HelpTip>}
        helper={helper ? strings.metadataHelper : undefined}
      />
      {advanced && (
        <details
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
          className="group text-ui"
        >
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-open:rotate-90"
            />
            {strings.moreOptions}
          </summary>
          <RadioGroup.Root
            aria-label={strings.metadataPolicyGroup}
            value={policy}
            onValueChange={(next) => {
              const match = METADATA_POLICIES.find((p) => p === next);
              if (match) onChange({ metadata: match });
            }}
            className="mt-2 flex flex-col gap-2 pl-[18px]"
          >
            {METADATA_POLICIES.map((option: MetadataPolicy) => {
              const itemId = `${id}-${option}`;
              return (
                <div key={option} className="flex items-center gap-2.5 text-sm">
                  <RadioGroup.Item
                    id={itemId}
                    value={option}
                    className={cn(
                      'grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border border-faint bg-card p-0',
                      'data-[state=checked]:border-accent',
                    )}
                  >
                    <RadioGroup.Indicator className="block size-2 rounded-full bg-accent" />
                  </RadioGroup.Item>
                  <label htmlFor={itemId} className="cursor-pointer">
                    {strings.metadataPolicies[option]}
                  </label>
                </div>
              );
            })}
          </RadioGroup.Root>
        </details>
      )}
      {showJpegNote && <Note>{strings.jpegOnly}</Note>}
    </div>
  );
}
