import { ExportError } from './errors';
import { safeFileName, splitExtension, uniqueNames } from './names';

/** The parts of the File System Access API we use (not in TypeScript's DOM types yet). */
interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: 'downloads' | 'pictures' | 'documents' | 'desktop';
}
type ShowDirectoryPicker = (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;

function getPicker(): ShowDirectoryPicker | undefined {
  if (typeof window === 'undefined' || !window.isSecureContext) return undefined;
  const picker = (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof picker === 'function' ? (picker as ShowDirectoryPicker).bind(window) : undefined;
}

/** True where the user can pick a folder to save into (Chrome, Edge, Opera; not Firefox or Safari). */
export function canSaveToFolder(): boolean {
  return getPicker() !== undefined;
}

const isDomError = (err: unknown, name: string) =>
  typeof err === 'object' && err !== null && 'name' in err && err.name === name;

/** True if the folder already has a file or folder with this name. */
async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (err) {
    if (isDomError(err, 'NotFoundError')) return false;
    if (isDomError(err, 'TypeMismatchError')) return true; // a folder has that name
    throw err;
  }
}

/** "photo.jpg" → first of "photo.jpg", "photo (2).jpg", "photo (3).jpg" … not in the folder. */
async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  if (!(await exists(dir, name))) return name;
  const [base, ext] = splitExtension(name);
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
}

/**
 * Asks the user for a folder and writes every file into it. Never overwrites: a name that's
 * already there gets " (2)", " (3)" …. Names are made safe and unique first.
 * Returns 'cancelled' if the user closes the picker. Must be called from a click handler.
 * Rejects with ExportError('save-failed') if writing fails (e.g. permission denied, disk full).
 */
export async function saveToFolder(
  files: Array<{ blob: Blob; name: string }>,
  onProgress?: (p: number) => void,
): Promise<'saved' | 'cancelled'> {
  const picker = getPicker();
  if (!picker) throw new ExportError('save-failed', 'Saving to a folder is not supported here');

  let dir: FileSystemDirectoryHandle;
  try {
    // Called before any other await so the browser still sees the user's click.
    dir = await picker({ id: 'snap-convert-export', mode: 'readwrite', startIn: 'downloads' });
  } catch (err) {
    if (isDomError(err, 'AbortError')) return 'cancelled';
    throw new ExportError('save-failed', String(err), { cause: err });
  }

  const names = uniqueNames(files.map((f) => safeFileName(f.name)));
  const totalBytes = files.reduce((sum, f) => sum + f.blob.size + 1, 0);
  let doneBytes = 0;
  onProgress?.(0);
  try {
    for (const [i, { blob }] of files.entries()) {
      const name = await freeName(dir, names[i] ?? '');
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(blob);
        await writable.close();
      } catch (err) {
        await writable.abort().catch(() => undefined);
        throw err;
      }
      doneBytes += blob.size + 1;
      onProgress?.(doneBytes / totalBytes);
    }
  } catch (err) {
    throw new ExportError('save-failed', err instanceof Error ? err.message : String(err), {
      cause: err,
    });
  }
  onProgress?.(1);
  return 'saved';
}
