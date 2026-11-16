import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, REVOKE_DELAY_MS } from './download';

describe('downloadBlob (real browser)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Captures the download link when it's clicked and stops the real download. */
  function captureClick(): Promise<HTMLAnchorElement> {
    return new Promise((resolve) => {
      const onClick = (event: MouseEvent) => {
        if (event.target instanceof HTMLAnchorElement) {
          event.preventDefault();
          document.removeEventListener('click', onClick, true);
          resolve(event.target);
        }
      };
      document.addEventListener('click', onClick, true);
    });
  }

  it('clicks a temporary link to an object URL with a safe name', async () => {
    const clicked = captureClick();
    const blob = new Blob(['hello'], { type: 'text/plain' });
    downloadBlob(blob, '../CON.txt');
    const link = await clicked;

    expect(link.download).toBe('CON_.txt');
    expect(link.href).toMatch(/^blob:/);
    // The link is removed from the page straight away.
    expect(link.isConnected).toBe(false);
    // The URL still points at the blob until it's revoked.
    const text = await (await fetch(link.href)).text();
    expect(text).toBe('hello');
  });

  it('revokes the object URL after the download has started', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const prevent = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('click', prevent, true);
    try {
      downloadBlob(new Blob(['x']), 'a.txt');
    } finally {
      document.removeEventListener('click', prevent, true);
    }

    expect(create).toHaveBeenCalledTimes(1);
    const url = create.mock.results[0]?.value as string;
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith(url);
  });

  it('still revokes the URL if the click throws', () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => downloadBlob(new Blob(['x']), 'a.txt')).toThrow('blocked');
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
