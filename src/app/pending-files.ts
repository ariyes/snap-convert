/**
 * Files dropped on the home page, waiting for the tool the user picked (D16).
 * The home page puts them here and navigates; the tool takes them once on mount.
 * In memory only: nothing is stored or sent anywhere.
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface PendingFilesState {
  toolId: string | null;
  files: File[];
}

export const usePendingFilesStore = create<PendingFilesState>(() => ({ toolId: null, files: [] }));

/** Hands files to a tool. Replaces anything still waiting. */
export function setPendingFiles(toolId: string, files: readonly File[]): void {
  usePendingFilesStore.setState({ toolId, files: [...files] });
}

/** Takes the files waiting for this tool (and clears them). Empty when none are waiting for it. */
export function takePendingFiles(toolId: string): File[] {
  const { toolId: waitingFor, files } = usePendingFilesStore.getState();
  if (waitingFor !== toolId || files.length === 0) return [];
  usePendingFilesStore.setState({ toolId: null, files: [] });
  return files;
}

export function clearPendingFiles(): void {
  usePendingFilesStore.setState({ toolId: null, files: [] });
}

/**
 * For tool pages: calls `onFiles` once after mount with the files the home page sent to this
 * tool, if any. Example: `usePendingFiles('compress-image', (files) => fileList.add(files))`.
 */
export function usePendingFiles(toolId: string, onFiles: (files: File[]) => void): void {
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });
  useEffect(() => {
    const files = takePendingFiles(toolId);
    if (files.length > 0) onFilesRef.current(files);
  }, [toolId]);
}
