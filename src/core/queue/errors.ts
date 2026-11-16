import { queueStrings } from './strings';

const OUT_OF_MEMORY_RE =
  /out of memory|allocation failed|(?:could not|cannot|failed to) allocate|invalid (?:array buffer|typed array) length/i;

function errorParts(error: unknown): { name: string; message: string } | null {
  if (error instanceof Error) return { name: error.name, message: error.message };
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
    return typeof message === 'string' ? { name, message } : null;
  }
  return null;
}

/** An error thrown inside a worker that means it ran out of memory (JS heap, ArrayBuffer or WebAssembly). */
export function isOutOfMemoryError(error: unknown): boolean {
  const parts = errorParts(error);
  if (!parts) return false;
  return OUT_OF_MEMORY_RE.test(parts.message) || /out ?of ?memory/i.test(parts.name);
}

/** The user-readable text for a job that failed with `error`. */
export function jobErrorMessage(error: unknown): string {
  if (isOutOfMemoryError(error)) return queueStrings.tooLarge;
  const parts = errorParts(error);
  const text = parts ? parts.message : typeof error === 'string' ? error : '';
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : queueStrings.failed;
}
