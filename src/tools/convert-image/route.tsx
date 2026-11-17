// Convert image (P15, IMG-01) and every format page (png-to-jpg, …): useToolPage() returns the
// format page's registry entry with `from`/`to`, and the target format starts at `to`.
// Head (title, description, canonical) comes from the registry via src/app/routes/tool-page.tsx.
import { useMemo, useState } from 'react';
import { useToolPage } from '@/app/use-tool-page';
import type { ImageFormat } from '@/core/contracts/image';
import {
  DimsPreview,
  FormatSelect,
  MetadataSelect,
  QualitySlider,
  ResizeFields,
} from '@/features/image-settings';
import { useToolSettings } from '@/features/settings';
import { PanelDivider } from '@/features/tool-layout';
import { Helper } from '@/ui';
import { SingleImageTool, withQualityFlag, type SingleImageContext } from '@/tools/_shared';
import { isFormatPage, type PageMeta } from '@/tools/registry';
import { BackgroundPicker } from './background-picker';
import {
  CONVERT_DEFAULTS,
  CONVERT_FORMATS,
  CONVERT_RESIZE_MODES,
  convertJobOptions,
  convertSettingsSchema,
  type ConvertToolSettings,
} from './settings';
import { convertStrings as strings } from './strings';

export default function ConvertImageRoute() {
  const page = useToolPage();
  // A fresh screen per page, so each format page starts with its own target.
  return <ConvertImage key={page.id} page={page} />;
}

function ConvertImage({ page }: { page: PageMeta }) {
  const preset = isFormatPage(page) ? page.to : undefined;
  // Settings are shared by Convert and the format pages, except the target: a format page always
  // starts at its own (PNG to JPG → JPG) and doesn't change what Convert remembers.
  const [stored, updateStored, resetStored] = useToolSettings(
    'convert-image',
    CONVERT_DEFAULTS,
    convertSettingsSchema,
  );
  const [pageFormat, setPageFormat] = useState<ImageFormat | undefined>(preset);
  const settings = useMemo<ConvertToolSettings>(
    () => (pageFormat === undefined ? stored : { ...stored, format: pageFormat }),
    [stored, pageFormat],
  );

  // Moving the quality slider switches the quality guard off (D28/D29).
  const update = (patch: Partial<ConvertToolSettings>) => {
    if (preset === undefined || patch.format === undefined) {
      updateStored(withQualityFlag(patch));
      return;
    }
    const { format, ...rest } = patch;
    setPageFormat(format);
    if (Object.keys(rest).length > 0) updateStored(withQualityFlag(rest));
  };
  const reset = () => {
    resetStored();
    setPageFormat(preset);
  };

  const jobOptions = useMemo(() => convertJobOptions(settings), [settings]);

  return (
    <SingleImageTool
      page={page}
      accept={page.accepts}
      jobOptions={jobOptions}
      panelTitle={strings.panelTitle}
      onReset={reset}
      panel={(context) => <ConvertPanel settings={settings} update={update} context={context} />}
    />
  );
}

function ConvertPanel({
  settings,
  update,
  context: { source, result },
}: {
  settings: ConvertToolSettings;
  update: (patch: Partial<ConvertToolSettings>) => void;
  context: SingleImageContext;
}) {
  const changeFormat = (patch: { format: ConvertToolSettings['format'] | 'keep' }) => {
    if (patch.format !== 'keep') update({ format: patch.format });
  };

  return (
    <>
      <FormatSelect
        value={settings}
        onChange={changeFormat}
        formats={CONVERT_FORMATS}
        graphic={result?.graphic}
      />
      {settings.format === 'jpeg' ? (
        <BackgroundPicker
          value={settings.background}
          onChange={(background) => update({ background })}
        />
      ) : (
        <Helper>{strings.keepsTransparency}</Helper>
      )}
      {settings.format !== 'png' && <QualitySlider value={settings} onChange={update} />}
      <PanelDivider />
      <ResizeFields
        optional
        modes={CONVERT_RESIZE_MODES}
        value={settings}
        onChange={update}
        preview={<DimsPreview optional source={source} values={settings} />}
      />
      <PanelDivider />
      <MetadataSelect value={settings} onChange={update} format={settings.format} />
    </>
  );
}
