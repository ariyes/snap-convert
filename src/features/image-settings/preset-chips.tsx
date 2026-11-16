import { useId } from 'react';
import type { WebPreset } from '@/core/contracts/image';
import { cn } from '@/lib/utils';
import { HelpTip, toast } from '@/ui';
import { imageSettingsStrings as strings } from './strings';

export interface PresetChipsProps {
  /** Web presets to offer (P12's list), in display order. */
  presets: ReadonlyArray<WebPreset>;
  /** The selected preset, or null when the settings are custom. */
  value: WebPreset['id'] | null;
  /** Called with the tapped preset; apply it with applyPreset(). */
  onSelect: (preset: WebPreset) => void;
  /** Show a toast with what the preset set (prototype behaviour). Default true. */
  announce?: boolean;
  className?: string;
}

/** The panel heading for presets: "Quick presets" with its help tip. Use as `panelTitle`. */
export function PresetsHeading() {
  return (
    <>
      {strings.presetsTitle}
      <HelpTip label={strings.presetsTipLabel}>{strings.presetsTip}</HelpTip>
    </>
  );
}

/**
 * IMG-06 one-tap web presets (prototype `.presets`). The selected chip is pressed; a manual change
 * elsewhere should clear it (see clearPresetOnChange).
 */
export function PresetChips({
  presets,
  value,
  onSelect,
  announce = true,
  className,
}: PresetChipsProps) {
  const id = useId();
  return (
    <div
      role="group"
      aria-label={strings.presetsTitle}
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {presets.map((preset) => {
        const summary = strings.presetSummary(preset.longestSide, preset.format, preset.quality);
        const descId = `${id}-${preset.id}`;
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={value === preset.id}
            aria-describedby={descId}
            title={summary}
            onClick={() => {
              onSelect(preset);
              if (announce) toast(strings.presetApplied(preset.name, summary), { id: 'preset' });
            }}
            className={cn(
              'h-[30px] cursor-pointer rounded-full border border-line bg-card px-2.5 text-xs font-medium text-fg',
              'hover:border-faint',
              'aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent',
            )}
          >
            {preset.name}
          </button>
        );
      })}
      {/* Descriptions read with each chip (aria-describedby works on hidden elements). */}
      {presets.map((preset) => (
        <span key={preset.id} id={`${id}-${preset.id}`} hidden>
          {strings.presetSummary(preset.longestSide, preset.format, preset.quality)}
        </span>
      ))}
    </div>
  );
}
