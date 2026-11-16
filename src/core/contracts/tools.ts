// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.
// `declare function` lines from the contract are exported as function types here.

import type { FileKind } from './intake';

export type ToolGroup = 'Images' | 'PDF' | 'Power tools';
export interface ToolMeta {
  id: string;                     // URL slug, e.g. 'compress-image'
  group: ToolGroup;
  name: string;                   // "Compress image"
  short: string;                  // one line for cards
  icon: string;                   // lucide icon name
  phase: 1 | 2 | 3;
  accepts: FileKind[];
  // SEO (filled in by P22)
  title?: string;                 // <title>
  description?: string;           // meta description
  howTo?: string[];
  faq?: Array<{ q: string; a: string }>;
}

/** Remembered settings per tool (APP-05). Versioned localStorage key, try/catch, falls back to defaults. */
export type UseToolSettings = <T extends object>(toolId: string, defaults: T) => [T, (patch: Partial<T>) => void, () => void]; // [settings, update, reset]
