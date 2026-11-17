// Small display helpers every tool uses: file sizes, size change and time left.
import { singleImageStrings as strings } from './strings';

const UNITS = strings.byteUnits;

/** "830 B", "4.2 KB", "38 KB", "3.4 MB" (1 KB = 1024 bytes, as file managers show it). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return strings.sizeUnknown;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  // 1023.6 KB would round to "1024 KB": show the next unit instead.
  if (unit < UNITS.length - 1 && Number(value.toFixed(digits)) >= 1024) {
    return `1 ${UNITS[unit + 1]}`;
  }
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** Time left for a run: "about 40 s left", "about 3 min left"; unknown → "estimating time…". */
export function formatTimeLeft(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return strings.estimatingTime;
  return strings.timeLeft(seconds);
}

export type SizeChange =
  { kind: 'smaller'; percent: number } | { kind: 'larger'; percent: number } | { kind: 'same' };

/** How the result's size compares with the original, in whole percent. */
export function sizeChange(before: number, after: number): SizeChange {
  if (!(before > 0) || !Number.isFinite(after)) return { kind: 'same' };
  const percent = Math.round((Math.abs(after - before) / before) * 100);
  if (after < before && percent > 0) return { kind: 'smaller', percent };
  if (after > before && percent > 0) return { kind: 'larger', percent };
  if (after > before) return { kind: 'larger', percent: 1 };
  if (after < before) return { kind: 'smaller', percent: 1 };
  return { kind: 'same' };
}
