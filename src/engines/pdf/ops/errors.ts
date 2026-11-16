export type PdfErrorCode =
  | 'encrypted'
  | 'damaged'
  | 'not-pdf'
  | 'timeout'
  | 'bad-image'
  | 'bad-input';

/**
 * A failure whose message can be shown to the user as-is. Comlink passes only `name` and
 * `message` across the worker boundary, so the message must stand on its own.
 */
export class PdfOpError extends Error {
  readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.name = 'PdfOpError';
    this.code = code;
  }
}

/** Rejects with `onTimeout()` if `promise` hasn't settled within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
