import { useId } from 'react';
import type { OutputFormat } from '@/core/contracts/image';
import { Field } from '@/features/tool-layout/panel';
import { Button, Label, Note, Select } from '@/ui';
import { imageSettingsStrings as strings } from './strings';
import { OUTPUT_FORMATS, type ImageSettingsValues } from './values';

export interface FormatSelectProps {
  value: Pick<ImageSettingsValues, 'format'>;
  onChange: (patch: Pick<ImageSettingsValues, 'format'>) => void;
  /** Formats to offer, in order. Default: Same as original, JPG, PNG, WebP, AVIF. */
  formats?: ReadonlyArray<OutputFormat>;
  /** The image looks like a graphic (text, logo, flat colour): suggest PNG. */
  graphic?: boolean;
  /** Short "Same" instead of "Same as original" (narrow layouts, e.g. Bulk). */
  compact?: boolean;
  className?: string;
}

/** "Save as" format picker, with a PNG hint for graphics. */
export function FormatSelect({
  value,
  onChange,
  formats = OUTPUT_FORMATS,
  graphic = false,
  compact = false,
  className,
}: FormatSelectProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const showHint = graphic && value.format !== 'png' && formats.includes('png');

  return (
    <Field className={className}>
      <Label htmlFor={id}>{strings.saveAs}</Label>
      <Select<OutputFormat>
        id={id}
        aria-describedby={showHint ? hintId : undefined}
        value={value.format}
        onValueChange={(format) => onChange({ format })}
        options={formats.map((format) => ({
          value: format,
          label:
            compact && format === 'keep' ? strings.formatKeepShort : strings.formatNames[format],
        }))}
      />
      {showHint && (
        <Note className="items-center">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span id={hintId}>{strings.graphicHint}</span>
            <Button size="sm" onClick={() => onChange({ format: 'png' })}>
              {strings.usePng}
            </Button>
          </span>
        </Note>
      )}
    </Field>
  );
}
