import { cleanup, renderHook, waitFor as waitForRtl } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderPageThumbnail, renderSlots } from './api';
import { readPdfInfo, usePageThumbnail, useThumbnails } from './index';
import { fixture, hundredPagePdf, preloadFixtures } from './test-helpers';

/** Other test files render in parallel, so allow more than RTL's default 1 s. */
const waitFor = (assertion: () => void) => waitForRtl(assertion, { timeout: 5000 });

beforeAll(async () => {
  await preloadFixtures();
  await readPdfInfo(fixture('text')); // load pdf.js once, outside the timed waits
});

afterEach(() => {
  cleanup();
});

/** A closed ImageBitmap reports 0 × 0. */
const isClosed = (bitmap: ImageBitmap) => bitmap.width === 0 && bitmap.height === 0;

describe('useThumbnails', () => {
  it('reads the info, fills in every page and closes the bitmaps on unmount', async () => {
    const file = fixture('mixed');
    const { result, unmount } = renderHook(() => useThumbnails(file, 48));
    expect(result.current).toEqual({ pages: [], info: null, error: null });

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(5);
      expect(result.current.pages.every((p) => p !== null)).toBe(true);
    });
    expect(result.current.info?.pages).toBe(5);
    expect(result.current.pages).toHaveLength(5);
    expect(result.current.error).toBeNull();

    const bitmaps = result.current.pages.filter((p): p is ImageBitmap => p !== null);
    expect(bitmaps.every((b) => !isClosed(b))).toBe(true);
    unmount();
    await waitFor(() => expect(bitmaps.every(isClosed)).toBe(true));
  });

  it('starts over when the size changes', async () => {
    const file = fixture('text');
    const { result, rerender } = renderHook(({ size }) => useThumbnails(file, size), {
      initialProps: { size: 32 },
    });
    await waitFor(() => expect(result.current.pages[0]).toBeTruthy());
    const small = result.current.pages[0]!;
    expect(Math.max(small.width, small.height)).toBe(Math.round(32 * devicePixelRatio));

    rerender({ size: 64 });
    expect(result.current.pages).toEqual([]);
    await waitFor(() => expect(result.current.pages[0]).toBeTruthy());
    const large = result.current.pages[0]!;
    expect(Math.max(large.width, large.height)).toBe(Math.round(64 * devicePixelRatio));
    await waitFor(() => expect(isClosed(small)).toBe(true));
  });

  it('reports a password-protected file as encrypted, without crashing', async () => {
    const file = fixture('encryptedUser'); // one File: a new File each render would restart the hook
    const { result } = renderHook(() => useThumbnails(file, 48));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.info).toEqual({ pages: 0, encrypted: true, pageSizes: [] });
    expect(result.current.error).toMatchObject({ name: 'PdfRenderError', code: 'encrypted' });
    expect(result.current.pages).toEqual([]);
  });

  it('stops rendering when unmounted', async () => {
    const file = await hundredPagePdf();
    const { result, unmount } = renderHook(() => useThumbnails(file, 48));
    await waitFor(() => expect(result.current.pages[0]).toBeTruthy());
    unmount();
    await waitFor(() => expect(renderSlots.active).toBe(0));
    const rendered = result.current.pages.filter(Boolean).length;
    expect(rendered).toBeLessThan(100);
  });
});

describe('usePageThumbnail', () => {
  it('renders only while enabled and keeps a finished thumbnail', async () => {
    const file = fixture('mixed');
    const { result, rerender } = renderHook(
      ({ enabled }) => usePageThumbnail(file, 1, 40, enabled),
      { initialProps: { enabled: false } },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result.current.bitmap).toBeNull();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.bitmap).not.toBeNull());
    const bitmap = result.current.bitmap!;
    rerender({ enabled: false });
    expect(result.current.bitmap).toBe(bitmap);
    expect(isClosed(bitmap)).toBe(false);
  });

  it('aborts a pending render when the page scrolls away', async () => {
    const file = await hundredPagePdf();
    // Fill both render slots so the page below has to wait in the queue.
    const busy = new AbortController();
    const blockers = [0, 1].map((i) => renderPageThumbnailBlocking(file, i, busy.signal));
    const { result, rerender } = renderHook(
      ({ enabled }) => usePageThumbnail(file, 99, 40, enabled),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false }); // scrolled away before it got a slot
    busy.abort();
    await Promise.all(blockers);
    await waitFor(() => expect(renderSlots.active).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result.current).toEqual({ bitmap: null, error: null });
  });
});

/** Holds a render slot until `signal` aborts. */
async function renderPageThumbnailBlocking(file: Blob, index: number, signal: AbortSignal) {
  await renderPageThumbnail(file, index, 2000, signal).then(
    (bitmap) => bitmap.close(),
    () => {},
  );
}
