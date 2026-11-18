// Reads each listed RAW file's details and thumbnail, one file at a time, in list order. Thumbnail
// URLs are revoked when their file leaves the list or the page closes.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntakeFile } from '@/core/contracts/intake';
import type { RawFileDetails } from './details';

function revoke(d: RawFileDetails | undefined): void {
  if (d?.status !== 'ready' || !d.thumbUrl) return;
  try {
    URL.revokeObjectURL(d.thumbUrl);
  } catch {
    // Already gone.
  }
}

const load = () => import('./details-loader');

/** Frees the main thread's RAW worker now (e.g. before a run, so phones have the memory). */
export async function closeDetailsWorker(): Promise<void> {
  (await load()).closeRawWorker();
}

interface Waiter {
  ids: readonly string[];
  resolve: () => void;
}

export interface RawDetailsState {
  /** File id → details, for the files read so far. */
  details: ReadonlyMap<string, RawFileDetails>;
  /** Resolves once every one of these files has been read (or has left the list). */
  whenRead: (ids: readonly string[]) => Promise<void>;
}

export function useRawDetails(files: readonly IntakeFile[]): RawDetailsState {
  const [details, setDetails] = useState<ReadonlyMap<string, RawFileDetails>>(() => new Map());
  const [known] = useState(() => new Map<string, RawFileDetails>());
  const listed = useRef(files);
  const reading = useRef(false);
  const alive = useRef(true);
  const waiters = useRef<Waiter[]>([]);

  /** Wakes the waiters whose files are all read or gone. */
  const settle = useCallback(() => {
    const ids = new Set(listed.current.map((f) => f.id));
    waiters.current = waiters.current.filter((w) => {
      const done = w.ids.every((id) => known.has(id) || !ids.has(id));
      if (done) w.resolve();
      return !done;
    });
  }, [known]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const d of known.values()) revoke(d);
      known.clear();
      for (const w of waiters.current) w.resolve();
      waiters.current = [];
    };
  }, [known]);

  useEffect(() => {
    listed.current = files;
    // Forget files that left the list (lookups are by listed id, so the state map can lag).
    const ids = new Set(files.map((f) => f.id));
    for (const [id, d] of known) {
      if (ids.has(id)) continue;
      revoke(d);
      known.delete(id);
    }
    settle();

    if (reading.current) return;
    const next = files.find((f) => !known.has(f.id));
    if (!next) return;
    reading.current = true;
    void (async () => {
      let result: RawFileDetails;
      try {
        result = await (await load()).loadRawDetails(next.file);
      } catch {
        // The reader itself couldn't load (offline before first use): no details, still runnable.
        result = { status: 'error', message: '' };
      }
      reading.current = false;
      if (!alive.current) {
        revoke(result);
        return;
      }
      if (listed.current.some((f) => f.id === next.id)) known.set(next.id, result);
      else revoke(result);
      // A new map either way, so this effect runs again for the next file.
      setDetails(new Map(known));
    })();
  }, [files, details, known, settle]);

  const whenRead = useCallback(
    (ids: readonly string[]) =>
      new Promise<void>((resolve) => {
        waiters.current.push({ ids, resolve });
        settle();
      }),
    [settle],
  );

  return { details, whenRead };
}
