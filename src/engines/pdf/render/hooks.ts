import { useEffect, useState } from 'react';
import type { PdfInfo } from '@/core/contracts/pdf';
import { readPdfInfo, renderPageThumbnail, renderThumbnails } from './api';
import { PdfRenderError } from './errors';

export interface ThumbnailsResult {
  /** One entry per page, `null` until that page has rendered. Bitmaps are closed by the hook. */
  pages: (ImageBitmap | null)[];
  info: PdfInfo | null;
  error: Error | null;
}

/** One run of the hook for one file and size; owns the bitmaps it rendered. */
interface Session {
  file: Blob;
  maxSize: number;
  bitmaps: ImageBitmap[];
}

interface ThumbnailsState extends ThumbnailsResult {
  session: Session;
}

const EMPTY: ThumbnailsResult = { pages: [], info: null, error: null };

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function withPage(pages: (ImageBitmap | null)[], index: number, bitmap: ImageBitmap) {
  const next = pages.slice();
  next[index] = bitmap;
  return next;
}

/**
 * Reads `file` and renders all its page thumbnails (`maxSize` CSS px on the long side, sharp at the
 * device pixel ratio). Rendering stops when the component unmounts or `file`/`maxSize` change, and
 * the bitmaps are closed then. A password-protected file gives `info.encrypted` and a
 * PdfRenderError('encrypted') in `error`.
 */
export function useThumbnails(file: Blob | null | undefined, maxSize: number): ThumbnailsResult {
  const [state, setState] = useState<ThumbnailsState | null>(null);

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    const { signal } = controller;
    const session: Session = { file, maxSize, bitmaps: [] };
    const fail = (error: unknown) => {
      if (signal.aborted) return;
      setState((prev) =>
        prev?.session === session
          ? { ...prev, error: toError(error) }
          : { session, ...EMPTY, error: toError(error) },
      );
    };

    readPdfInfo(file)
      .then((info) => {
        if (signal.aborted) return;
        const locked = info.encrypted && info.pages === 0;
        setState({
          session,
          info,
          pages: Array.from({ length: info.pages }, () => null),
          error: locked ? new PdfRenderError('encrypted') : null,
        });
        if (locked || info.pages === 0) return;
        return renderThumbnails(
          file,
          maxSize,
          (index, bitmap) => {
            session.bitmaps.push(bitmap);
            setState((prev) =>
              prev?.session === session
                ? { ...prev, pages: withPage(prev.pages, index, bitmap) }
                : prev,
            );
          },
          signal,
        );
      })
      .catch(fail);

    return () => controller.abort();
  }, [file, maxSize]);

  // Close a session's bitmaps once a newer session replaces it, or on unmount.
  const session = state?.session;
  useEffect(() => () => session?.bitmaps.forEach((bitmap) => bitmap.close()), [session]);

  if (!file || !state || state.session.file !== file || state.session.maxSize !== maxSize) {
    return EMPTY;
  }
  return { pages: state.pages, info: state.info, error: state.error };
}

export interface PageThumbnailResult {
  /** `null` until rendered. Closed by the hook. */
  bitmap: ImageBitmap | null;
  error: Error | null;
}

interface PageThumbnailState extends PageThumbnailResult {
  file: Blob;
  pageIndex: number;
  maxSize: number;
}

/**
 * Renders one page thumbnail (0-based `pageIndex`) while `enabled` is true. For long page grids:
 * pass `enabled = false` when the page scrolls out of view and its pending render is aborted
 * (an already rendered thumbnail is kept).
 */
export function usePageThumbnail(
  file: Blob | null | undefined,
  pageIndex: number,
  maxSize: number,
  enabled = true,
): PageThumbnailResult {
  const [state, setState] = useState<PageThumbnailState | null>(null);
  const current =
    !!file && state?.file === file && state.pageIndex === pageIndex && state.maxSize === maxSize;
  const done = current && (state.bitmap !== null || state.error !== null);

  useEffect(() => {
    if (!file || !enabled || done) return;
    const controller = new AbortController();
    renderPageThumbnail(file, pageIndex, maxSize, controller.signal).then(
      (bitmap) => {
        if (controller.signal.aborted) bitmap.close();
        else setState({ file, pageIndex, maxSize, bitmap, error: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ file, pageIndex, maxSize, bitmap: null, error: toError(error) });
        }
      },
    );
    return () => controller.abort();
  }, [file, pageIndex, maxSize, enabled, done]);

  // Close a bitmap once a newer result replaces it, or on unmount.
  const bitmap = state?.bitmap;
  useEffect(() => () => bitmap?.close(), [bitmap]);

  return current ? { bitmap: state.bitmap, error: state.error } : { bitmap: null, error: null };
}
