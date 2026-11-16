import { useId } from 'react';
import { Field, PanelSection } from '@/features/tool-layout/panel';
import { Helper, HelpTip, Label, NumberField, Segmented, Slider } from '@/ui';
import { imageSettingsStrings as strings } from './strings';
import { LIMITS, type ImageSettingsValues, type QualityMode } from './values';

type QualityValues = Pick<ImageSettingsValues, 'qualityMode' | 'quality' | 'targetKb'>;

export interface QualitySliderProps {
  value: Pick<ImageSettingsValues, 'quality'>;
  onChange: (patch: Pick<ImageSettingsValues, 'quality'>) => void;
  /** Without the help tip and helper line (e.g. next to "Save as" in Bulk). */
  compact?: boolean;
  className?: string;
}

/** Quality slider, 10–100 (default 80). */
export function QualitySlider({ value, onChange, compact = false, className }: QualitySliderProps) {
  return (
    <Slider
      label={strings.quality}
      tip={
        compact ? undefined : (
          <HelpTip label={strings.qualityTipLabel}>{strings.qualityTip}</HelpTip>
        )
      }
      helper={compact ? undefined : strings.qualityHelper}
      value={value.quality}
      onValueChange={(quality) => onChange({ quality })}
      min={LIMITS.quality.min}
      max={LIMITS.quality.max}
      className={className}
    />
  );
}

export interface QualityOrTargetProps {
  value: QualityValues;
  onChange: (patch: Partial<QualityValues>) => void;
  className?: string;
}

/** IMG-04/05: "By quality" (slider 10–100) or "Target file size" (KB). */
export function QualityOrTarget({ value, onChange, className }: QualityOrTargetProps) {
  const id = useId();
  const targetId = `${id}-target`;
  const helperId = `${id}-target-helper`;

  return (
    <PanelSection className={className}>
      <Segmented<QualityMode>
        label={strings.compressionMode}
        value={value.qualityMode}
        onValueChange={(qualityMode) => onChange({ qualityMode })}
        options={[
          { value: 'quality', label: strings.byQuality },
          { value: 'target', label: strings.targetFileSize },
        ]}
      />
      {value.qualityMode === 'quality' ? (
        <QualitySlider value={value} onChange={onChange} />
      ) : (
        <Field>
          <span>
            <Label htmlFor={targetId}>{strings.targetLabel}</Label>
            <HelpTip label={strings.targetTipLabel}>{strings.targetTip}</HelpTip>
          </span>
          <NumberField
            id={targetId}
            aria-describedby={helperId}
            value={value.targetKb}
            onValueChange={(targetKb) => onChange({ targetKb })}
            min={LIMITS.targetKb.min}
            max={LIMITS.targetKb.max}
            step={10}
            unit={strings.unitKb}
          />
          <Helper id={helperId}>{strings.targetHelper}</Helper>
        </Field>
      )}
    </PanelSection>
  );
}
