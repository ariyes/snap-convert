// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.
// `declare function` lines from the contract are exported as function types here.

export type TrackEvent = { name: 'tool-run'; tool: string; files: number } | { name: 'download'; tool: string; kind: 'single' | 'zip' | 'folder' };
/** Cookie-free. Never include file names, sizes or contents. No-op if blocked or disabled. */
export type Track = (e: TrackEvent) => void;
