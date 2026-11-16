// useFileList(toolId): the files a tool is working on, one Zustand store per tool.
// Owns the thumbnail object URLs: made when a file is added, revoked when it is removed or cleared.

import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { isPhoneLike, readDevice } from '@/core/queue/device';
import { toast } from '@/ui';
import { keepAccepted } from './intake';
import { intakeStrings } from './strings';

/** Above either, phones get a one-time "it may be slow" warning. There is no hard limit. */
export const PHONE_WARN_LIMITS = {
  bytes: 2 * 1024 ** 3,
  files: 500,
} as const;

export interface AddOptions {
  /** Keep out files of other kinds, with a "N files skipped" toast. */
  accept?: readonly FileKind[];
}

export interface FileListState {
  files: IntakeFile[];
  /** Adds files, ignoring ones already in the list (same name, size and date). Returns the files added. */
  add: (files: readonly IntakeFile[], options?: AddOptions) => IntakeFile[];
  remove: (id: string) => void;
  clear: () => void;
  /** Moves the file at index `from` to index `to`. */
  reorder: (from: number, to: number) => void;
}

/** Same file picked twice: same name, size and last-modified time. */
function sameFileKey(f: IntakeFile): string {
  return `${f.name}\u0000${f.size}\u0000${f.file.lastModified}`;
}

/** Only images the browser can show get a thumbnail URL; HEIC, PDF and RAW previews come from their engines. */
function withThumb(f: IntakeFile): IntakeFile {
  if (f.kind !== 'image' || f.thumbUrl) return f;
  try {
    return { ...f, thumbUrl: URL.createObjectURL(f.file) };
  } catch {
    return f;
  }
}

function revoke(f: IntakeFile): void {
  if (!f.thumbUrl) return;
  try {
    URL.revokeObjectURL(f.thumbUrl);
  } catch {
    // Already gone.
  }
}

export interface FileListStoreOptions {
  /** Is this a phone? Defaults to the device check the worker pool uses. */
  isPhone?: () => boolean;
}

export function createFileListStore(options: FileListStoreOptions = {}): StoreApi<FileListState> {
  const isPhone = options.isPhone ?? (() => isPhoneLike(readDevice()));
  let warned = false;

  const warnIfHeavy = (files: readonly IntakeFile[]) => {
    if (warned) return;
    const bytes = files.reduce((n, f) => n + f.size, 0);
    if (files.length <= PHONE_WARN_LIMITS.files && bytes <= PHONE_WARN_LIMITS.bytes) return;
    if (!isPhone()) return;
    warned = true;
    toast(intakeStrings.phoneSlow, { duration: 6000 });
  };

  return createStore<FileListState>()((set, get) => ({
    files: [],

    add: (incoming, addOptions = {}) => {
      const accepted = addOptions.accept ? keepAccepted(incoming, addOptions.accept) : incoming;
      const seen = new Set(get().files.map(sameFileKey));
      const added: IntakeFile[] = [];
      for (const f of accepted) {
        const key = sameFileKey(f);
        if (seen.has(key)) continue;
        seen.add(key);
        added.push(withThumb(f));
      }
      if (added.length === 0) return [];
      const files = [...get().files, ...added];
      set({ files });
      warnIfHeavy(files);
      return added;
    },

    remove: (id) => {
      const gone = get().files.find((f) => f.id === id);
      if (!gone) return;
      revoke(gone);
      set({ files: get().files.filter((f) => f.id !== id) });
    },

    clear: () => {
      for (const f of get().files) revoke(f);
      set({ files: [] });
    },

    reorder: (from, to) => {
      const files = [...get().files];
      if (from === to || from < 0 || from >= files.length || to < 0 || to >= files.length) return;
      const [moved] = files.splice(from, 1);
      if (!moved) return;
      files.splice(to, 0, moved);
      set({ files });
    },
  }));
}

const stores = new Map<string, StoreApi<FileListState>>();

/** The file list store of a tool (made on first use, kept while the app is open). */
export function fileListStore(toolId: string): StoreApi<FileListState> {
  let store = stores.get(toolId);
  if (!store) {
    store = createFileListStore();
    stores.set(toolId, store);
  }
  return store;
}

/** For tests: clears every tool's list (revoking its URLs) and forgets the stores. */
export function resetFileLists(): void {
  for (const store of stores.values()) store.getState().clear();
  stores.clear();
}

/**
 * The files of a tool, plus add / remove / clear / reorder.
 *
 *   const { files, add, remove } = useFileList('compress-image');
 *   <DropZone accept={tool.accepts} onFiles={add} />
 *
 * Pass a selector to re-render only when that part changes: `useFileList(id, (s) => s.files.length)`.
 */
export function useFileList(toolId: string): FileListState;
export function useFileList<T>(toolId: string, selector: (state: FileListState) => T): T;
export function useFileList<T>(
  toolId: string,
  selector?: (state: FileListState) => T,
): T | FileListState {
  const pick: (state: FileListState) => T | FileListState = selector ?? ((s) => s);
  return useStore(fileListStore(toolId), pick);
}
