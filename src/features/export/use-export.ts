// The state behind <ExportBar>: ZIP download and "Save to folder", with progress, a done message and
// plain-language errors. ExportBar makes its own; a page that shows the same export in two places
// (Bulk: the summary bar and the panel) makes one with useExport and passes it to the bar.

import { useCallback, useState, useSyncExternalStore } from 'react';
import { downloadBlob } from './download';
import { ExportError } from './errors';
import { canSaveToFolder, saveToFolder } from './folder';
import { exportStrings as t } from './strings';
import { zipFiles } from './zip';

export type ExportKind = 'single' | 'zip' | 'folder';

export type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; action: 'zip' | 'folder'; progress: number }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

export type ExportFile = { blob: Blob; name: string };

export interface ExportState {
  status: ExportStatus;
  /** Downloads one file (no progress, nothing to wait for). */
  single: (file: ExportFile) => void;
  zip: () => Promise<void>;
  folder: () => Promise<void>;
  reset: () => void;
  /** "Save to folder" works in this browser (Chrome, Edge); false while pre-rendering. */
  folderSupported: boolean;
}

const noSubscribe = () => () => undefined;

function errorMessage(err: unknown, fallback: 'zip-failed' | 'save-failed'): string {
  return t.errors[err instanceof ExportError ? err.code : fallback];
}

/**
 * Export actions for the files `getFiles` returns at the moment of the click (names are made safe
 * and unique on export). `onExport` is called once after each successful export, e.g. to count it
 * with track().
 */
export function useExport(
  getFiles: () => readonly ExportFile[],
  zipName: string = t.defaultZipName,
  onExport?: (kind: ExportKind) => void,
): ExportState {
  const folderSupported = useSyncExternalStore(noSubscribe, canSaveToFolder, () => false);
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' });

  const single = useCallback(
    (file: ExportFile) => {
      downloadBlob(file.blob, file.name);
      setStatus({ kind: 'idle' });
      onExport?.('single');
    },
    [onExport],
  );

  const zip = useCallback(async () => {
    const files = getFiles();
    if (files.length === 0) return;
    setStatus({ kind: 'busy', action: 'zip', progress: 0 });
    try {
      const blob = await zipFiles([...files], (progress) =>
        setStatus({ kind: 'busy', action: 'zip', progress }),
      );
      downloadBlob(blob, /\.zip$/i.test(zipName) ? zipName : `${zipName}.zip`);
      setStatus({ kind: 'done', message: t.zipReady });
      onExport?.('zip');
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err, 'zip-failed') });
    }
  }, [getFiles, zipName, onExport]);

  const folder = useCallback(async () => {
    const files = getFiles();
    if (files.length === 0) return;
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
  }, [getFiles, onExport]);

  const reset = useCallback(() => setStatus({ kind: 'idle' }), []);

  return { status, single, zip, folder, reset, folderSupported };
}
