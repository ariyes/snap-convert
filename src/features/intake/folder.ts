// Files from a drop, including whole folders (walked recursively through the File and Directory
// Entries API, `webkitGetAsEntry`, which every current browser supports). Hidden files are skipped.

/** Names that are hidden or system clutter: dot files (".DS_Store", "._photo.jpg"), Windows extras. */
export function isHiddenName(name: string): boolean {
  if (name.startsWith('.')) return true;
  const lower = name.toLowerCase();
  return lower === 'thumbs.db' || lower === 'desktop.ini' || lower === '__macosx';
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The parts of FileSystemEntry we use (so tests can pass plain objects). */
export interface EntryLike {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}
interface FileEntryLike extends EntryLike {
  file(success: (file: File) => void, error?: (err: unknown) => void): void;
}
interface DirectoryEntryLike extends EntryLike {
  createReader(): {
    readEntries(success: (entries: EntryLike[]) => void, error?: (err: unknown) => void): void;
  };
}

function entryFile(entry: FileEntryLike): Promise<File | undefined> {
  return new Promise((resolve) => {
    try {
      entry.file(resolve, () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}

/** All children of a folder. readEntries returns them in batches (100 in Chrome) until empty. */
async function readAll(dir: DirectoryEntryLike): Promise<EntryLike[]> {
  const reader = dir.createReader();
  const all: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve) => {
      try {
        reader.readEntries(resolve, () => resolve([]));
      } catch {
        resolve([]);
      }
    });
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/** Files under an entry, depth first, each folder sorted by name ("photo 2" before "photo 10"). */
export async function filesFromEntry(entry: EntryLike): Promise<File[]> {
  if (isHiddenName(entry.name)) return [];
  if (entry.isFile) {
    const file = await entryFile(entry as FileEntryLike);
    return file ? [file] : [];
  }
  if (!entry.isDirectory) return [];
  const children = (await readAll(entry as DirectoryEntryLike)).sort((a, b) =>
    byName.compare(a.name, b.name),
  );
  const out: File[] = [];
  for (const child of children) out.push(...(await filesFromEntry(child)));
  return out;
}

/**
 * Every file in a drop, with folders expanded. Must be called synchronously in the drop handler:
 * the entries (and `dataTransfer.files`) are only available during the event.
 */
export function filesFromDataTransfer(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return Promise.resolve([]);
  const items = Array.from(dt.items ?? []).filter((item) => item.kind === 'file');
  if (items.length === 0) {
    return Promise.resolve(Array.from(dt.files ?? []).filter((f) => !isHiddenName(f.name)));
  }
  // Take everything now, while the event lasts: the entry if the browser gives one, and the file.
  // WebKit gives files made in memory (not from disk) an entry whose file() fails with
  // NotFoundError; the file taken here stands in for it then.
  const taken = items.map((item): { entry: EntryLike | null; file: File | null } => ({
    entry: typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null,
    file: item.getAsFile(),
  }));
  return (async () => {
    const out: File[] = [];
    for (const { entry, file } of taken) {
      if (entry?.isDirectory) {
        out.push(...(await filesFromEntry(entry)));
      } else {
        const name = entry?.name ?? file?.name;
        if (name === undefined || isHiddenName(name)) continue;
        const opened = entry?.isFile ? await entryFile(entry as FileEntryLike) : undefined;
        const found = opened ?? file;
        if (found) out.push(found);
      }
    }
    return out;
  })();
}
