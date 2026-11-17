// Resize image (P15, IMG-02/03/09). Head (title, description, canonical) comes from the registry
// via src/app/routes/tool-page.tsx.
import { useMemo } from 'react';
import { useToolPage } from '@/app/use-tool-page';
import {
  DimsPreview,
  FormatSelect,
  MetadataSelect,
  planSize,
  QualitySlider,
  RenamePattern,
  ResizeFields,
} from '@/features/image-settings';
import { useToolSettings } from '@/features/settings';
import { PanelDivider } from '@/features/tool-layout';
import {
  baseName,
  EXTENSIONS,
  SingleImageTool,
  withQualityFlag,
  type SingleImageContext,
} from '@/tools/_shared';
import { AnchorPicker } from './anchor-picker';
import {
  RESIZE_DEFAULTS,
  RESIZE_MODES,
  resizeJobOptions,
  resizeSettingsSchema,
  type ResizeToolSettings,
} from './settings';
import { resizeStrings as strings } from './strings';

export default function ResizeImageRoute() {
  const page = useToolPage();
  const [settings, save, reset] = useToolSettings(
    'resize-image',
    RESIZE_DEFAULTS,
    resizeSettingsSchema,
  );
  // Moving the quality slider switches the quality guard off (D28/D29).
  const update = (patch: Partial<ResizeToolSettings>) => save(withQualityFlag(patch));
  const jobOptions = useMemo(() => resizeJobOptions(settings), [settings]);

  return (
    <SingleImageTool
      page={page}
      accept={page.accepts}
      jobOptions={jobOptions}
      namePattern={settings.rename}
      panelTitle={strings.panelTitle}
      onReset={reset}
      panel={(context) => <ResizePanel settings={settings} update={update} context={context} />}
    />
  );
}

function ResizePanel({
  settings,
  update,
  context: { file, source, result },
}: {
  settings: ResizeToolSettings;
  update: (patch: Partial<ResizeToolSettings>) => void;
  context: SingleImageContext;
}) {
  const plan = source ? planSize(source, settings) : null;
  const sourceExt = file?.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const ext = result
    ? EXTENSIONS[result.format]
    : settings.format === 'keep'
      ? sourceExt
      : EXTENSIONS[settings.format];
  const fill = settings.resizeMode === 'exact' && settings.fit === 'fill';

  return (
    <>
      <ResizeFields
        value={settings}
        onChange={update}
        modes={RESIZE_MODES}
        preview={
          <>
            {fill && (
              <AnchorPicker value={settings.anchor} onChange={(anchor) => update({ anchor })} />
            )}
            <DimsPreview source={source} values={settings} />
          </>
        }
      />
      <PanelDivider />
      <FormatSelect value={settings} onChange={update} graphic={result?.graphic} />
      {settings.format !== 'png' && <QualitySlider value={settings} onChange={update} />}
      <RenamePattern
        value={settings}
        onChange={update}
        example={{
          name: file ? baseName(file.name) : 'photo',
          width: result?.width ?? plan?.output.width,
          height: result?.height ?? plan?.output.height,
          n: 1,
          format: ext,
        }}
      />
      <PanelDivider />
      <MetadataSelect value={settings} onChange={update} format={settings.format} />
    </>
  );
}
