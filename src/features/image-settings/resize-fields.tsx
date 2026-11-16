import { Lock } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { FitMode } from '@/core/contracts/sizing';
import { Field, PanelSection } from '@/features/tool-layout/panel';
import {
  Checkbox,
  FitFillPicture,
  Helper,
  HelpTip,
  Label,
  Note,
  NumberField,
  RadioCards,
  Select,
  strings as uiStrings,
  Swatches,
  type SwatchOption,
} from '@/ui';
import { imageSettingsStrings as strings } from './strings';
import { LIMITS, RESIZE_FIELD_MODES, type ResizeFieldMode, type ResizeValues } from './values';

/** Padding colours from the prototype. These are output colours (data), not theme colours. */
export const DEFAULT_PAD_COLORS: ReadonlyArray<SwatchOption> = [
  { value: '#ffffff', label: strings.padColourNames.white },
  { value: '#000000', label: strings.padColourNames.black },
  { value: '#f3f2f0', label: strings.padColourNames.lightGrey },
  { value: 'transparent', label: uiStrings.transparent },
];

export interface ResizeFieldsProps {
  value: ResizeValues;
  onChange: (patch: Partial<ResizeValues>) => void;
  /** Modes to offer, in order. Default: all (Longest side … Don't resize). */
  modes?: ReadonlyArray<ResizeFieldMode>;
  /**
   * Resizing is optional (Compress): an "Also resize" checkbox turns it on, and the mode and size
   * share one row. Otherwise (Bulk, Resize) a labelled "Resize by" field is shown.
   */
  optional?: boolean;
  /** Padding colours for Exact size, Fit. Default: white, black, light grey, transparent. */
  padColors?: ReadonlyArray<SwatchOption>;
  /** Shown at the end of the section, e.g. a <DimsPreview>. */
  preview?: ReactNode;
  className?: string;
}

/**
 * IMG-02/03 resize settings: mode, size with unit, Exact W × H with Fit / Fill and padding colour,
 * and "Enlarge smaller images" (off; warns that enlarged images can look soft when on).
 * Proportions are always kept: sizes come from the sizing rule, never from these fields directly.
 */
export function ResizeFields({
  value,
  onChange,
  modes = RESIZE_FIELD_MODES,
  optional = false,
  padColors = DEFAULT_PAD_COLORS,
  preview,
  className,
}: ResizeFieldsProps) {
  const id = useId();
  const active = !optional || value.resizeEnabled;
  const mode = value.resizeMode;
  const simple = mode === 'longest' || mode === 'width' || mode === 'height' || mode === 'percent';
  const percentMax = value.upscale ? LIMITS.percent.maxUpscale : LIMITS.percent.max;

  const modeSelect = (
    <Select<ResizeFieldMode>
      id={optional ? undefined : `${id}-mode`}
      aria-label={optional ? strings.resizeBy : undefined}
      value={mode}
      onValueChange={(resizeMode) => onChange({ resizeMode })}
      options={modes.map((m) => ({ value: m, label: strings.resizeModes[m] }))}
    />
  );

  const sizeField =
    mode === 'percent' ? (
      <NumberField
        key="percent"
        aria-label={strings.size}
        value={value.resizePercent}
        onValueChange={(resizePercent) => onChange({ resizePercent })}
        min={LIMITS.percent.min}
        max={percentMax}
        unit={strings.unitPercent}
      />
    ) : (
      <NumberField
        key="px"
        aria-label={strings.size}
        value={value.resizeSize}
        onValueChange={(resizeSize) => onChange({ resizeSize })}
        min={LIMITS.side.min}
        max={LIMITS.side.max}
        unit={strings.unitPx}
      />
    );

  return (
    <PanelSection className={className}>
      {optional && (
        <Checkbox
          checked={value.resizeEnabled}
          onCheckedChange={(resizeEnabled) => onChange({ resizeEnabled })}
          label={<span className="font-medium">{strings.alsoResize}</span>}
          tip={<HelpTip label={strings.alsoResizeTipLabel}>{strings.alsoResizeTip}</HelpTip>}
          helper={strings.alsoResizeHelper}
        />
      )}

      {active && optional && (
        <div className="flex items-center gap-2.5 *:min-w-0 *:flex-1">
          {modeSelect}
          {simple && sizeField}
        </div>
      )}

      {active && !optional && (
        <>
          <Field>
            <span>
              <Label htmlFor={`${id}-mode`}>{strings.resizeBy}</Label>
              <HelpTip label={strings.resizeByTipLabel}>{strings.resizeByTip}</HelpTip>
            </span>
            {modeSelect}
          </Field>
          {simple && (
            <>
              {sizeField}
              <Note icon={Lock}>
                {value.upscale ? strings.lockedNoteUpscale : strings.lockedNote}
              </Note>
            </>
          )}
        </>
      )}

      {active && mode === 'exact' && (
        <ExactFields value={value} onChange={onChange} padColors={padColors} />
      )}

      {active && mode !== 'none' && (
        <>
          <Checkbox
            checked={value.upscale}
            onCheckedChange={(upscale) =>
              onChange(
                upscale
                  ? { upscale }
                  : {
                      upscale,
                      resizePercent: Math.min(value.resizePercent, LIMITS.percent.max),
                    },
              )
            }
            label={strings.upscale}
          />
          {value.upscale && <Note>{strings.upscaleNote}</Note>}
        </>
      )}

      {preview}
    </PanelSection>
  );
}

function ExactFields({
  value,
  onChange,
  padColors,
}: {
  value: ResizeValues;
  onChange: (patch: Partial<ResizeValues>) => void;
  padColors: ReadonlyArray<SwatchOption>;
}) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <NumberField
          className="min-w-0 flex-1"
          aria-label={strings.width}
          value={value.exactWidth}
          onValueChange={(exactWidth) => onChange({ exactWidth })}
          min={LIMITS.side.min}
          max={LIMITS.side.max}
          unit={strings.unitWidth}
        />
        <span aria-hidden="true" className="text-faint">
          {strings.times}
        </span>
        <NumberField
          className="min-w-0 flex-1"
          aria-label={strings.height}
          value={value.exactHeight}
          onValueChange={(exactHeight) => onChange({ exactHeight })}
          min={LIMITS.side.min}
          max={LIMITS.side.max}
          unit={strings.unitHeight}
        />
      </div>
      <span className="text-ui font-medium text-muted">
        {strings.fitTitle}
        <HelpTip label={strings.fitTipLabel}>{strings.fitTip}</HelpTip>
      </span>
      <RadioCards<FitMode>
        label={strings.fitGroup}
        value={value.fit}
        onValueChange={(fit) => onChange({ fit })}
        options={[
          {
            value: 'fit',
            title: strings.fit,
            description: strings.fitDescription,
            picture: <FitFillPicture mode="fit" />,
          },
          {
            value: 'fill',
            title: strings.fill,
            description: strings.fillDescription,
            picture: <FitFillPicture mode="fill" />,
          },
        ]}
      />
      {value.fit === 'fit' && (
        <div className="flex flex-col gap-2.5">
          <span className="text-ui font-medium text-muted">{strings.padColour}</span>
          <Swatches
            label={strings.padColour}
            options={padColors}
            value={value.padColor}
            onValueChange={(padColor) => onChange({ padColor })}
          />
        </div>
      )}
      <Helper>{strings.neverStretched}</Helper>
    </>
  );
}
