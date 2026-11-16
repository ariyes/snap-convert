// Schema check for remembered settings (APP-05). Anything stored that doesn't look like the
// defaults is ignored, key by key, so a corrupt or outdated value can never break a tool.

/** Checks one stored value. Return true when it can be used as-is. */
export type SettingCheck<V> = (value: unknown) => value is V;

/** Optional stricter checks per key, e.g. `{ format: oneOf(['jpeg', 'png']) }`. */
export type SettingsSchema<T extends object> = { [K in keyof T]?: SettingCheck<T[K]> };

/** A check that only accepts one of the listed values. */
export function oneOf<const V extends string | number | boolean | null>(
  values: readonly V[],
): SettingCheck<V> {
  return (value: unknown): value is V => (values as readonly unknown[]).includes(value);
}

/** A check for a finite number within `min`–`max`. */
export function numberIn(min: number, max: number): SettingCheck<number> {
  return (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** Same kind of value as the default (numbers must be finite; objects are checked key by key). */
function sameShape(stored: unknown, fallback: unknown): boolean {
  if (fallback === null) return isPrimitive(stored); // e.g. `preset: null` may hold a preset id
  if (typeof fallback === 'number') return typeof stored === 'number' && Number.isFinite(stored);
  if (Array.isArray(fallback)) {
    if (!Array.isArray(stored)) return false;
    const [sample] = fallback as unknown[];
    return sample === undefined || stored.every((item) => sameShape(item, sample));
  }
  if (isPlainObject(fallback)) return isPlainObject(stored);
  return typeof stored === typeof fallback;
}

function mergeObject(
  stored: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fallback)) {
    out[key] = mergeValue(stored[key], fallback[key], undefined);
  }
  return out;
}

function mergeValue(
  stored: unknown,
  fallback: unknown,
  check: ((v: unknown) => boolean) | undefined,
) {
  if (stored === undefined) return fallback;
  if (check) return check(stored) ? stored : fallback;
  if (!sameShape(stored, fallback)) return fallback;
  if (isPlainObject(fallback) && isPlainObject(stored)) return mergeObject(stored, fallback);
  return stored;
}

/**
 * Builds settings from a stored value and the defaults.
 * - Only keys that exist in `defaults` are kept (unknown stored keys are dropped).
 * - A stored value is used only when it passes the key's schema check or, without one, has the
 *   same type as the default (finite numbers only; nested objects are checked key by key).
 * - Anything else, including a stored value that isn't an object, falls back to the default.
 */
export function sanitizeSettings<T extends object>(
  stored: unknown,
  defaults: T,
  schema: SettingsSchema<T> = {},
): T {
  if (!isPlainObject(stored)) return { ...defaults };
  const out: Record<string, unknown> = {};
  const fallback = defaults as Record<string, unknown>;
  const checks = schema as Record<string, ((v: unknown) => boolean) | undefined>;
  for (const key of Object.keys(fallback)) {
    out[key] = mergeValue(stored[key], fallback[key], checks[key]);
  }
  return out as T;
}

/** Parses stored JSON text into settings; broken JSON (or nothing stored) gives the defaults. */
export function parseSettings<T extends object>(
  raw: string | null,
  defaults: T,
  schema?: SettingsSchema<T>,
): T {
  if (raw === null) return { ...defaults };
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { ...defaults };
  }
  return sanitizeSettings(stored, defaults, schema);
}
