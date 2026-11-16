/** Why an export failed. The UI turns each code into a plain-language message (strings.ts). */
export type ExportErrorCode =
  | 'zip-too-large' // over 4 GB: the ZIP format without ZIP64 can't hold it
  | 'zip-too-many-files' // over 65,535 files: same limit
  | 'zip-failed'
  | 'save-failed';

export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = 'ExportError';
    this.code = code;
  }
}
