// Small store over localStorage for remembered settings. Every access is wrapped in try/catch:
// in a private window, with storage blocked or full, settings still work for the session (kept
// in memory) and are simply not remembered.

type Listener = () => void;

/** The session copy. Once a key is read or written here, this is what the page uses. */
const memory = new Map<string, string | null>();
const listeners = new Map<string, Set<Listener>>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // e.g. SecurityError when storage is blocked
  }
}

function notify(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}

/** The stored text for `key`, or null when nothing is stored (or storage can't be read). */
export function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  let raw: string | null;
  try {
    raw = storage()?.getItem(key) ?? null;
  } catch {
    raw = null;
  }
  memory.set(key, raw);
  return raw;
}

/** Stores `raw` for `key` (null removes it) and tells subscribers. */
export function writeRaw(key: string, raw: string | null): void {
  memory.set(key, raw);
  try {
    const store = storage();
    if (raw === null) store?.removeItem(key);
    else store?.setItem(key, raw);
  } catch {
    // Full or blocked: keep the session copy only.
  }
  notify(key);
}

/** Changes made in another tab arrive as `storage` events. */
function onStorageEvent(event: StorageEvent): void {
  if (event.key === null) {
    // localStorage.clear() in another tab
    const keys = [...memory.keys()];
    memory.clear();
    keys.forEach(notify);
    return;
  }
  if (!listeners.has(event.key)) return;
  memory.set(event.key, event.newValue);
  notify(event.key);
}

/** Calls `listener` whenever the stored value of `key` changes. Returns the unsubscribe function. */
export function subscribeRaw(key: string, listener: Listener): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorageEvent);
  }
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorageEvent);
    }
  };
}

/** Test helper: forget the session copy so the next read goes to localStorage again. */
export function clearSettingsMemory(): void {
  memory.clear();
}
