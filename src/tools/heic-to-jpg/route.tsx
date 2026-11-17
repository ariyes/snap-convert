// HEIC to JPG (P15). Takes HEIC photos only; other images are offered to Convert image.
// Head (title, description, canonical) comes from the registry via src/app/routes/tool-page.tsx.
import { ArrowRight, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { setPendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { FormatSelect, MetadataSelect, QualitySlider } from '@/features/image-settings';
import { useToolSettings } from '@/features/settings';
import { PanelDivider } from '@/features/tool-layout';
import { Button, Helper, IconButton, Note } from '@/ui';
import { SingleImageTool, withQualityFlag } from '@/tools/_shared';
import {
  HEIC_DEFAULTS,
  HEIC_FORMATS,
  heicJobOptions,
  heicSettingsSchema,
  type HeicToolSettings,
} from './settings';
import { heicStrings as strings } from './strings';

/** The drop zone takes other images too, so they can be sent on to Convert image. */
const DROP_ACCEPT: readonly FileKind[] = ['heic', 'image'];

export default function HeicToJpgRoute() {
  const page = useToolPage();
  const navigate = useNavigate();
  const [settings, save, reset] = useToolSettings('heic-to-jpg', HEIC_DEFAULTS, heicSettingsSchema);
  // Moving the quality slider switches the quality guard off (D28/D29).
  const update = (patch: Partial<HeicToolSettings>) => save(withQualityFlag(patch));
  const jobOptions = useMemo(() => heicJobOptions(settings), [settings]);
  const [others, setOthers] = useState<File[]>([]);

  const onIncoming = useCallback((files: IntakeFile[]) => {
    const heic = files.filter((f) => f.kind === 'heic');
    const rest = files.filter((f) => f.kind !== 'heic').map((f) => f.file);
    if (rest.length > 0) setOthers(rest);
    return heic;
  }, []);

  const notice = others.length > 0 && (
    <Note className="items-center" data-testid="not-heic">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 flex-[1_1_220px]">{strings.notHeic(others.length)}</span>
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            onClick={() => {
              setPendingFiles('convert-image', others);
              void navigate('/convert-image');
            }}
          >
            {strings.openInConvert}
            <ArrowRight aria-hidden="true" />
          </Button>
          <IconButton size="sm" label={strings.dismiss} onClick={() => setOthers([])}>
            <X aria-hidden="true" />
          </IconButton>
        </span>
      </span>
    </Note>
  );

  return (
    <SingleImageTool
      page={page}
      accept={DROP_ACCEPT}
      description={strings.description}
      dropTitle={strings.dropTitle}
      dropSubtitle={strings.dropSubtitle}
      onIncoming={onIncoming}
      notice={notice}
      jobOptions={jobOptions}
      panelTitle={strings.panelTitle}
      onReset={reset}
      panel={({ result }) => (
        <>
          <FormatSelect
            value={settings}
            onChange={(patch) => {
              if (patch.format !== 'keep') update({ format: patch.format });
            }}
            formats={HEIC_FORMATS}
            graphic={result?.graphic}
          />
          {settings.format === 'jpeg' && <QualitySlider value={settings} onChange={update} />}
          <Helper>{strings.upright}</Helper>
          <PanelDivider />
          <MetadataSelect value={settings} onChange={update} format={settings.format} />
        </>
      )}
    />
  );
}
