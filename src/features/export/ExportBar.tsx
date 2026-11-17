import { CircleAlert, Download, FolderArchive, FolderDown, LoaderCircle } from 'lucide-react';
import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button, ProgressBar, strings } from '@/ui';
import { exportStrings as t } from './strings';
import { useExport, type ExportFile, type ExportKind, type ExportState } from './use-export';

export type { ExportKind } from './use-export';

export interface ExportBarProps {
  /** Finished results (what the ZIP and "Save to folder" export). Names are made safe and unique. */
  files: readonly ExportFile[];
  /**
   * Which file the single Download button saves. Defaults to the only file when there is one;
   * with several files and no selection only the ZIP and folder buttons show.
   */
  selected?: number;
  /**
   * The file the Download button saves, instead of `selected`. `null` shows the button, not ready
   * yet (e.g. the file on screen is still being made while others are done).
   */
  single?: ExportFile | null;
  /** The number on the ZIP button while `files` is still incomplete (defaults to `files.length`). */
  count?: number;
  /** ZIP file name without ".zip". */
  zipName?: string;
  /** Called after each successful export, e.g. to count it with track(). */
  onExport?: (kind: ExportKind) => void;
  disabled?: boolean;
  /**
   * `bar` (default): buttons in a row, wrapping. `panel`: the settings panel's actions — full-width
   * buttons with the first one tall on wide screens, and one row in the phone action bar with short
   * labels ("All (ZIP)").
   */
  variant?: 'bar' | 'panel';
  /**
   * Where "Save to folder" shows (only in browsers that support it): `always` (default), `wide`
   * (not in the phone action bar, where two buttons share the row) or `never` (the page offers it
   * elsewhere).
   */
  folder?: 'always' | 'wide' | 'never';
  /** Always export everything as a ZIP, even a single file (no single Download button). */
  zipOnly?: boolean;
  /**
   * Export state from `useExport`, for a page that shows the same export elsewhere too. Its own
   * files, ZIP name and onExport are used for ZIP and folder.
   */
  state?: ExportState;
  /** Text of the single Download button (default "Download"). */
  singleLabel?: string;
  /** Text of the ZIP button on wide screens (default "Download all N as ZIP"). */
  zipLabel?: string;
  /** Show progress and the done message here (default). Off when the page shows them elsewhere. */
  showStatus?: boolean;
  className?: string;
}

/** Download one file, all files as a ZIP, or save them straight into a folder. */
export function ExportBar({
  files,
  selected,
  single,
  count,
  zipName = t.defaultZipName,
  onExport,
  disabled = false,
  variant = 'bar',
  folder = 'always',
  zipOnly = false,
  state,
  singleLabel = strings.download,
  zipLabel,
  showStatus = true,
  className,
}: ExportBarProps) {
  const getFiles = useCallback(() => files, [files]);
  const own = useExport(getFiles, zipName, onExport);
  const { status, folderSupported } = state ?? own;
  const busy = status.kind === 'busy';
  const off = disabled || busy;
  const noFiles = files.length === 0;

  const singleFile = zipOnly
    ? undefined
    : single !== undefined
      ? single
      : files.length === 1
        ? files[0]
        : selected !== undefined
          ? files[selected]
          : undefined;
  const showSingle = !zipOnly && (single !== undefined || singleFile !== undefined);
  const zipCount = count ?? files.length;
  const showZip = zipOnly || zipCount > 1;

  const panel = variant === 'panel';
  // Panel buttons: full width on wide screens; in the phone bar they share one row.
  const buttonClass = panel
    ? 'w-full max-[880px]:w-auto max-[880px]:min-w-0 max-[880px]:flex-1 max-[880px]:px-4 max-[880px]:text-body'
    : undefined;
  const firstClass = panel ? 'min-[880px]:h-12 min-[880px]:px-[22px] min-[880px]:text-base' : '';
  const spinner = <LoaderCircle aria-hidden="true" className="animate-spin" />;
  const percent = busy ? Math.round(status.progress * 100) : 0;
  const wideZip = zipLabel ?? strings.downloadAllCountZip(zipCount);
  // In the phone bar the ZIP button shares its row with Download, so it gets a short label.
  const shortZip = panel && showSingle;

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        // The phone action bar sizes its children for single buttons; this bar sizes its own.
        panel && 'max-[880px]:h-auto! max-[880px]:gap-1.5',
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-wrap gap-2',
          panel && 'flex-col max-[880px]:flex-row-reverse max-[880px]:flex-nowrap',
        )}
      >
        {showSingle && (
          <Button
            variant="primary"
            className={cn(buttonClass, firstClass)}
            onClick={() => singleFile && (state ?? own).single(singleFile)}
            disabled={off || !singleFile}
          >
            <Download aria-hidden="true" />
            {singleLabel}
          </Button>
        )}
        {showZip && (
          <Button
            variant={showSingle ? 'default' : 'primary'}
            className={cn(buttonClass, !showSingle && firstClass)}
            onClick={() => void (state ?? own).zip()}
            disabled={off || noFiles}
            aria-label={shortZip ? wideZip : undefined}
          >
            {busy && status.action === 'zip' ? spinner : <FolderArchive aria-hidden="true" />}
            {shortZip ? (
              <>
                <span className="max-[880px]:hidden">{wideZip}</span>
                <span aria-hidden="true" className="min-[880px]:hidden">
                  {t.downloadAllShort}
                </span>
              </>
            ) : (
              wideZip
            )}
          </Button>
        )}
        {folderSupported && folder !== 'never' && (
          <Button
            className={cn(buttonClass, folder === 'wide' && 'max-[880px]:hidden')}
            onClick={() => void (state ?? own).folder()}
            disabled={off || noFiles}
            title={t.saveToFolderHint}
          >
            {busy && status.action === 'folder' ? spinner : <FolderDown aria-hidden="true" />}
            {t.saveToFolder}
          </Button>
        )}
      </div>

      {showStatus && (
        <div role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
          {busy && (
            <div className="flex flex-col gap-1.5">
              <span>{status.action === 'zip' ? t.zipping(percent) : t.saving(percent)}</span>
              <ProgressBar value={status.progress} label={t.progressLabel} size="lg" />
            </div>
          )}
          {status.kind === 'done' && status.message}
        </div>
      )}

      {showStatus && status.kind === 'error' && (
        <p role="alert" className="flex items-start gap-2 text-sm text-bad">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {status.message}
        </p>
      )}
    </div>
  );
}
