// Download (current) and Download all as ZIP, laid out as in the prototype: big buttons at the
// bottom of the panel on wide screens, "All (ZIP)" + "Download" sharing the fixed bar on phones.
// Built on the export module's downloadBlob / zipFiles (see the P14 report on ExportBar).
import { Download, FolderArchive, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import {
  downloadBlob,
  ExportError,
  exportStrings,
  zipFiles,
  type ExportKind,
} from '@/features/export';
import { ResponsiveLabel } from '@/features/tool-layout';
import { Button, strings as uiStrings, toast } from '@/ui';
import { compressStrings as t } from './strings';

export interface DownloadsProps {
  /** The selected file's fresh result, ready to save. */
  current: { blob: Blob; name: string } | null;
  /** Every finished result, in file order; null while some are still being made. */
  all: ReadonlyArray<{ blob: Blob; name: string }> | null;
  /** How many files there are (the ZIP button shows while there are several). */
  total: number;
  onExport: (kind: ExportKind) => void;
}

export function Downloads({ current, all, total, onExport }: DownloadsProps) {
  const [zipProgress, setZipProgress] = useState<number | null>(null);
  const zipping = zipProgress !== null;
  const count = all?.length ?? total;

  const zip = async () => {
    if (!all || all.length === 0) return;
    setZipProgress(0);
    try {
      const blob = await zipFiles([...all], setZipProgress);
      downloadBlob(blob, `${t.zipName}.zip`);
      toast(exportStrings.zipReady, { id: 'zip' });
      onExport('zip');
    } catch (error) {
      const code = error instanceof ExportError ? error.code : 'zip-failed';
      toast(exportStrings.errors[code], { id: 'zip', duration: 8000 });
    } finally {
      setZipProgress(null);
    }
  };

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!current}
        onClick={() => {
          if (!current) return;
          downloadBlob(current.blob, current.name);
          onExport('single');
        }}
      >
        <Download aria-hidden="true" />
        {uiStrings.download}
      </Button>
      {total > 1 && (
        <Button
          block
          disabled={!all || all.length === 0 || zipping}
          onClick={() => void zip()}
          aria-label={zipping ? undefined : uiStrings.downloadAllCountZip(count)}
        >
          {zipping ? (
            <>
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              {t.zipping(Math.round((zipProgress ?? 0) * 100))}
            </>
          ) : (
            <>
              <FolderArchive aria-hidden="true" />
              <ResponsiveLabel
                wide={uiStrings.downloadAllCountZip(count)}
                narrow={t.downloadAllShort}
              />
            </>
          )}
        </Button>
      )}
    </>
  );
}
