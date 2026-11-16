import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';

/** localStorage key for the chosen theme. Also read by `themeScript` before first paint. */
export const THEME_STORAGE_KEY = 'snapconvert:theme';

const ORDER: readonly Theme[] = ['system', 'light', 'dark'];

/** system → light → dark → system (same order as the prototype). */
export function nextTheme(theme: Theme): Theme {
  return ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system';
}

function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readStored(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function writeStored(theme: Theme): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode, settings): the choice lasts for this page only.
  }
}

/** Sets or removes `data-theme` on <html>. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

// A tiny shared store so every useTheme() caller sees the same value.
let current: Theme | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): Theme {
  current ??= readStored();
  return current;
}

function getServerSnapshot(): Theme {
  return 'system';
}

function emit(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
  current = readStored();
  applyTheme(current);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener('storage', onStorage);
    // Normally themeScript already did this before paint; make sure <html> matches anyway.
    applyTheme(getSnapshot());
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** Changes the theme everywhere: <html> attribute, storage and every useTheme() caller. */
export function setTheme(theme: Theme): void {
  current = theme;
  writeStored(theme);
  applyTheme(theme);
  emit();
}

export interface UseTheme {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Moves to the next theme and returns it. */
  cycleTheme: () => Theme;
}

/** The user's theme choice ('system' follows the device). Persisted in localStorage when available. */
export function useTheme(): UseTheme {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const cycleTheme = useCallback(() => {
    const next = nextTheme(getSnapshot());
    setTheme(next);
    return next;
  }, []);
  return { theme, setTheme, cycleTheme };
}
