// Paste (Ctrl/⌘ + V) anywhere on the page adds the pasted files to one target: the drop zone
// mounted last, i.e. the one on the current page. Earlier targets get it back when it unmounts.

import { useEffect, useRef } from 'react';
import { namePastedFile } from './intake';

export type PasteHandler = (files: File[]) => void;

const targets: PasteHandler[] = [];

/** Files on the clipboard (screenshots, or files copied in the file manager). */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length > 0) return files;
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

function onPaste(event: ClipboardEvent): void {
  const target = targets[targets.length - 1];
  if (!target) return;
  const files = filesFromClipboard(event.clipboardData);
  // Text pastes (into a field, say) are left alone.
  if (files.length === 0) return;
  event.preventDefault();
  target(files.map((f) => namePastedFile(f)));
}

/** Makes `handler` the active paste target until the returned function is called. */
export function registerPasteTarget(handler: PasteHandler): () => void {
  if (targets.length === 0) document.addEventListener('paste', onPaste);
  targets.push(handler);
  return () => {
    const i = targets.lastIndexOf(handler);
    if (i >= 0) targets.splice(i, 1);
    if (targets.length === 0) document.removeEventListener('paste', onPaste);
  };
}

/** The handler that currently receives pastes (for tests). */
export function activePasteTarget(): PasteHandler | undefined {
  return targets[targets.length - 1];
}

/** While mounted (and `enabled`), pasted files go to `handler`. */
export function usePasteTarget(handler: PasteHandler, enabled = true): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    return registerPasteTarget((files) => latest.current(files));
  }, [enabled]);
}
