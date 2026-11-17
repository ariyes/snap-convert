import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { Field } from '@/features/tool-layout';
import { cn } from '@/lib/utils';
import { Checkbox, Helper, Segmented } from '@/ui';
import type { WebFormat } from './settings';
import { formatNames, optimizeStrings as t } from './strings';

export interface FormatPickerProps {
  value: WebFormat;
  onChange: (format: WebFormat) => void;
}

/** JPG (default) or WebP; AVIF behind "Advanced". */
export function FormatPicker({ value, onChange }: FormatPickerProps) {
  const id = useId();
  const advancedId = `${id}-advanced`;
  const [open, setOpen] = useState(false);
  // Keep the AVIF choice visible while it's the one in use.
  const showAdvanced = open || value === 'avif';

  return (
    <Field>
      <span aria-hidden="true" className="text-ui font-medium text-muted">
        {t.formatTitle}
      </span>
      <Segmented<WebFormat>
        label={t.formatLabel}
        value={value}
        onValueChange={onChange}
        options={[
          { value: 'jpeg', label: formatNames.jpeg },
          { value: 'webp', label: formatNames.webp },
        ]}
      />
      <Helper aria-live="polite">{t.formatHelp[value]}</Helper>
      <button
        type="button"
        aria-expanded={showAdvanced}
        aria-controls={advancedId}
        onClick={() => setOpen(!showAdvanced)}
        className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent p-0 text-ui font-medium text-muted hover:text-fg"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-4 transition-transform', showAdvanced && 'rotate-90')}
        />
        {t.advanced}
      </button>
      <div id={advancedId} hidden={!showAdvanced}>
        <Checkbox
          checked={value === 'avif'}
          onCheckedChange={(checked) => onChange(checked ? 'avif' : 'jpeg')}
          label={t.useAvif}
          helper={t.avifHelper}
        />
      </div>
    </Field>
  );
}
