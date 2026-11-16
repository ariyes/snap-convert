// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.
// `declare function` lines from the contract are exported as function types here.

export interface NamePatternContext { name: string; width?: number; height?: number; n: number; format: string }

export type ApplyNamePattern = (pattern: string, ctx: NamePatternContext) => string; // tokens {name} {width} {height} {n} {format}; safe file name; no extension added
export type UniqueNames = (names: string[]) => string[];                              // "a.jpg","a.jpg" → "a.jpg","a (2).jpg"
export type DownloadBlob = (blob: Blob, name: string) => void;
export type ZipFiles = (files: Array<{ blob: Blob; name: string }>, onProgress?: (p: number) => void) => Promise<Blob>; // fflate, names made unique
export type CanSaveToFolder = () => boolean;
export type SaveToFolder = (files: Array<{ blob: Blob; name: string }>) => Promise<'saved' | 'cancelled'>;
