// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.
// `declare function` lines from the contract are exported as function types here.

export type FileKind = 'image' | 'heic' | 'pdf' | 'raw' | 'unknown';

export interface IntakeFile {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: FileKind;                 // detected from the file's first bytes, not the extension
  width?: number;                 // images, filled in after a quick header read
  height?: number;
  thumbUrl?: string;              // object URL, revoked when removed
  error?: string;
}

export type DetectKind = (file: Blob) => Promise<FileKind>;
// <DropZone accept={FileKind[]} multiple onFiles={(files: IntakeFile[]) => void} pasteHint /> — also listens for paste
