import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { UseToolSettings } from '@/core/contracts/tools';
import { parseSettings, type SettingsSchema } from './schema';
import { readRaw, subscribeRaw, writeRaw } from './storage';

/** Bump when a tool's settings change shape in a way old stored values can't follow. */
export const SETTINGS_VERSION = 1;

/** localStorage key for a tool's settings, e.g. `snapconvert:settings:compress-image:v1`. */
export function settingsKey(toolId: string): string {
  return `snapconvert:settings:${toolId}:v${SETTINGS_VERSION}`;
}

/** Nothing is stored while pre-rendering or hydrating, so the first render always shows the defaults. */
const serverSnapshot = (): string | null => null;

/**
 * Remembered settings per tool (APP-05): `[settings, update, reset]`.
 *
 * - Stored under a versioned key (`settingsKey`). Every storage access is wrapped in try/catch;
 *   without storage (private window, blocked, full) settings still work for the session.
 * - Stored values are checked against `defaults` (and the optional per-key `schema`): unknown keys
 *   are dropped and invalid values or corrupt JSON fall back to the defaults.
 * - `update(patch)` merges a patch and saves it; `reset()` forgets the stored value, so the
 *   defaults apply again (including any preset selection kept in settings).
 * - `defaults` and `schema` are read once, when the component mounts.
 * - Components using the same tool id share one value, in this tab and across tabs.
 */
export function useToolSettings<T extends object>(
  toolId: string,
  defaults: T,
  schema?: SettingsSchema<T>,
): [T, (patch: Partial<T>) => void, () => void] {
  const key = settingsKey(toolId);
  const [base] = useState(() => ({ defaults: { ...defaults }, schema }));

  const subscribe = useCallback((listener: () => void) => subscribeRaw(key, listener), [key]);
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), serverSnapshot);
  const settings = useMemo(() => parseSettings(raw, base.defaults, base.schema), [raw, base]);

  const update = useCallback(
    (patch: Partial<T>) => {
      // Read the latest value (not this render's) so several updates in a row all apply.
      const current = parseSettings(readRaw(key), base.defaults, base.schema);
      writeRaw(key, JSON.stringify({ ...current, ...patch }));
    },
    [key, base],
  );
  const reset = useCallback(() => writeRaw(key, null), [key]);

  return [settings, update, reset];
}

// Compile-time check: matches the shared contract in src/core/contracts/tools.ts.
useToolSettings satisfies UseToolSettings;
