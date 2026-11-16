import { CircleAlert, Download, FolderArchive, FolderDown, LoaderCircle } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { downloadBlob } from './download';
import { ExportError } from './errors';
import { canSaveToFolder, saveToFolder } from './folder';
import { exportStrings as t } from './strings';
import { zipFiles } from './zip';

export type ExportKind = 'single' | 'zip' | 'folder';

export interface ExportBarProps {
  /** Finished results. Names are made safe and unique on export. */
  files: ReadonlyArray<{ blob: Blob; name: string }>;
  /**
   * Which file the single Download button saves. Defaults to the only file when there is one;
   * with several files and no selection only the ZIP and folder buttons show.
   */
  selected?: number;
  /** ZIP file name without ".zip". */
  zipName?: string;
  /** Called after each successful export, e.g. to count it with track(). */
  onExport?: (kind: ExportKind) => void;
  disabled?: boolean;
  className?: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; action: 'zip' | 'folder'; progress: number }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

const noSubscribe = () => () => undefined;

/** Folder support never changes while the page is open; false while pre-rendering. */
function useCanSaveToFolder(): boolean {
  return useSyncExternalStore(noSubscribe, canSaveToFolder, () => false);
}

function errorMessage(err: unknown, fallback: keyof typeof t.errors): string {
  return t.errors[err instanceof ExportError ? err.code : fallback];
}

const buttonBase =
  'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border px-4 font-medium transition ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0';
const primary = 'border-accent bg-accent text-on-accent hover:opacity-90';
const secondary = 'border-line bg-card text-fg hover:border-faint';

function ActionButton(props: {
  onClick: () => void;
  disabled: boolean;
  primary: boolean;
  icon: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={cn(buttonBase, props.primary ? primary : secondary)}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {props.icon}
      {props.children}
    </button>
  );
}

/** Download one file, all files as a ZIP, or save them straight into a folder. */
export function ExportBar({
  files,
  selected,
  zipName = t.defaultZipName,
  onExport,
  disabled = false,
  className,
}: ExportBarProps) {
  const folderSupported = useCanSaveToFolder();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const busy = status.kind === 'busy';
  const off = disabled || busy || files.length === 0;

  const single =
    files.length === 1 ? files[0] : selected !== undefined ? files[selected] : undefined;
  const showZip = files.length > 1;

  const handleDownload = () => {
    if (!single) return;
    downloadBlob(single.blob, single.name);
    setStatus({ kind: 'idle' });
    onExport?.('single');
  };

  const handleZip = async () => {
    setStatus({ kind: 'busy', action: 'zip', progress: 0 });
    try {
      const zip = await zipFiles([...files], (progress) =>
        setStatus({ kind: 'busy', action: 'zip', progress }),
      );
      const name = /\.zip$/i.test(zipName) ? zipName : `${zipName}.zip`;
      downloadBlob(zip, name);
      setStatus({ kind: 'done', message: t.zipReady });
      onExport?.('zip');
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err, 'zip-failed') });
    }
  };

  const handleFolder = async () => {
    // saveToFolder opens the picker straight away, while the click still counts as a user gesture.
    const saving = saveToFolder([...files], (progress) =>
      setStatus({ kind: 'busy', action: 'folder', progress }),
    );
    try {
      if ((await saving) === 'cancelled') {
        setStatus({ kind: 'idle' });
        return;
      }
      setStatus({ kind: 'done', message: t.saved(files.length) });
      onExport?.('folder');
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err, 'save-failed') });
    }
  };

  const percent = busy ? Math.round(status.progress * 100) : 0;
  const spinner = <LoaderCircle aria-hidden className="animate-spin" />;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap gap-2">
        {single && (
          <ActionButton
            primary
            onClick={handleDownload}
            disabled={off}
            icon={<Download aria-hidden />}
          >
            {t.download}
          </ActionButton>
        )}
        {showZip && (
          <ActionButton
            primary={!single}
            onClick={() => void handleZip()}
            disabled={off}
            icon={busy && status.action === 'zip' ? spinner : <FolderArchive aria-hidden />}
          >
            {t.downloadZip(files.length)}
          </ActionButton>
        )}
        {folderSupported && (
          <ActionButton
            primary={false}
            onClick={() => void handleFolder()}
            disabled={off}
            title={t.saveToFolderHint}
            icon={busy && status.action === 'folder' ? spinner : <FolderDown aria-hidden />}
          >
            {t.saveToFolder}
          </ActionButton>
        )}
      </div>

      <div role="status" aria-live="polite" className="text-muted text-sm empty:hidden">
        {busy && (
          <div className="flex flex-col gap-1.5">
            <span>{status.action === 'zip' ? t.zipping(percent) : t.saving(percent)}</span>
            <div
              role="progressbar"
              aria-label={t.progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="bg-sunk h-1.5 w-full overflow-hidden rounded-full"
            >
              <div
                className="bg-accent h-full rounded-full transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
        {status.kind === 'done' && status.message}
      </div>

      {status.kind === 'error' && (
        <p role="alert" className="text-bad flex items-start gap-2 text-sm">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {status.message}
        </p>
      )}
    </div>
  );
}
