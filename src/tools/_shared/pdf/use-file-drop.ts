import { useEffect, useRef, useState, type DragEvent } from 'react';
import { filesFromDataTransfer } from '@/features/intake';

function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Lets files be dropped onto the workspace once the big drop zone has gone (folders too). While
 * enabled, a file dropped elsewhere on the page is ignored instead of the browser opening it.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const latest = useRef(onFiles);
  useEffect(() => {
    latest.current = onFiles;
  });

  useEffect(() => {
    if (!enabled) return;
    const block = (e: globalThis.DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, [enabled]);

  const props = {
    onDragEnter: (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      depth.current = 0;
      setOver(false);
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      // Entries must be taken during the event; reading them can finish later.
      void filesFromDataTransfer(e.dataTransfer).then((files) => {
        if (files.length > 0) latest.current(files);
      });
    },
  };

  return { over: enabled && over, props };
}
