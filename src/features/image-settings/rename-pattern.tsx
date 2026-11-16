import { useId } from 'react';
import type { NamePatternContext } from '@/core/contracts/export';
import { applyNamePattern } from '@/features/export';
import { Field } from '@/features/tool-layout/panel';
import { Helper, HelpTip, Input, Label } from '@/ui';
import { imageSettingsStrings as strings } from './strings';
import { LIMITS, type ImageSettingsValues } from './values';

export interface RenamePatternProps {
  value: Pick<ImageSettingsValues, 'rename'>;
  onChange: (patch: Pick<ImageSettingsValues, 'rename'>) => void;
  /**
   * File used for the live example, usually the first one: base name, new size, number and the
   * output extension (`format`, e.g. 'jpg').
   */
  example: NamePatternContext;
  className?: string;
}

/** IMG-09 file-name pattern with a live example ("e.g. IMG_2041-1920w.jpg") and token help. */
export function RenamePattern({ value, onChange, example, className }: RenamePatternProps) {
  const id = useId();
  const helperId = `${id}-helper`;
  const exampleName = `${applyNamePattern(value.rename, example)}.${example.format}`;

  return (
    <Field className={className}>
      <span>
        <Label htmlFor={id}>{strings.fileNames}</Label>
        <HelpTip label={strings.fileNamesTipLabel}>{strings.fileNamesTip}</HelpTip>
      </span>
      <Input
        id={id}
        className="font-mono"
        spellCheck={false}
        autoComplete="off"
        maxLength={LIMITS.rename.maxLength}
        aria-describedby={helperId}
        value={value.rename}
        onChange={(event) => onChange({ rename: event.target.value })}
      />
      <Helper id={helperId} className="wrap-anywhere">
        {strings.fileNamesExample} <span className="font-mono">{exampleName}</span> ·{' '}
        {strings.fileNamesTokens}
      </Helper>
    </Field>
  );
}
