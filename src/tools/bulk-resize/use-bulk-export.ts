// ZIP download and "Save to folder" for the finished batch. Built on P09's zipFiles / saveToFolder
// (ZIP made in a worker; names made safe and unique there too) so the summary bar and the panel's
// primary button share one export state.

import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  canSaveToFolder,
  downloadBlob,
  ExportError,
  exportStrings,
  saveToFolder,
  zipFiles,
  type ExportKind,
} from '@/features/export';

export type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; action: 'zip' | 'folder'; progress: number }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

type ExportFile = { blob: Blob; name: string };

const noSubscribe = () => () => undefined;

function errorMessage(err: unknown, fallback: 'zip-failed' | 'save-failed'): string {
  return exportStrings.errors[err instanceof ExportError ? err.code : fallback];
}

export function useBulkExport(
  getFiles: () => ExportFile[],
  zipName: string,
  onExported: (kind: ExportKind) => void,
) {
  const folderSupported = useSyncExternalStore(noSubscribe, canSaveToFolder, () => false);
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' });

  const zip = useCallback(async () => {
    const files = getFiles();
    if (files.length === 0) return;
    setStatus({ kind: 'busy', action: 'zip', progress: 0 });
    try {
      const blob = await zipFiles(files, (progress) =>
        setStatus({ kind: 'busy', action: 'zip', progress }),
      );
      downloadBlob(blob, `${zipName}.zip`);
      setStatus({ kind: 'done', message: exportStrings.zipReady });
      onExported('zip');
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err, 'zip-failed') });
    }
  }, [getFiles, zipName, onExported]);

  const folder = useCallback(async () => {
    const files = getFiles();
    if (files.length === 0) return;
    // Opens the picker straight away, while the click still counts as a user gesture.
    const saving = saveToFolder(files, (progress) =>
      setStatus({ kind: 'busy', action: 'folder', progress }),
    );
    try {
      if ((await saving) === 'cancelled') {
        setStatus({ kind: 'idle' });
        return;
      }
      setStatus({ kind: 'done', message: exportStrings.saved(files.length) });
      onExported('folder');
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err, 'save-failed') });
    }
  }, [getFiles, onExported]);

  const reset = useCallback(() => setStatus({ kind: 'idle' }), []);

  return { status, zip, folder, reset, folderSupported };
}
