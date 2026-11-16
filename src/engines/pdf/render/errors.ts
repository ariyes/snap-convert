/** Why a PDF couldn't be read. The UI maps `code` to a translated message. */
export type PdfRenderErrorCode = 'encrypted' | 'invalid';

const messages: Record<PdfRenderErrorCode, string> = {
  encrypted: 'The PDF is password-protected.',
  invalid: 'The file is not a readable PDF.',
};

export class PdfRenderError extends Error {
  readonly code: PdfRenderErrorCode;

  constructor(code: PdfRenderErrorCode, options?: ErrorOptions) {
    super(messages[code], options);
    this.name = 'PdfRenderError';
    this.code = code;
  }
}

/** pdf.js exceptions are recognised by name, so this file never imports pdf.js. */
export function toPdfRenderError(error: unknown): unknown {
  if (error instanceof PdfRenderError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return new PdfRenderError('encrypted', { cause: error });
  if (name === 'InvalidPDFException' || name === 'FormatError') {
    return new PdfRenderError('invalid', { cause: error });
  }
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
