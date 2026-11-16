import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './download';
import { ExportError } from './errors';
import { ExportBar } from './ExportBar';
import { canSaveToFolder, saveToFolder } from './folder';
import { strings } from '@/ui';
import { exportStrings } from './strings';
import { zipFiles } from './zip';

vi.mock('./download', () => ({ downloadBlob: vi.fn() }));
vi.mock('./zip', () => ({ zipFiles: vi.fn() }));
vi.mock('./folder', () => ({ canSaveToFolder: vi.fn(() => false), saveToFolder: vi.fn() }));

const file = (name: string) => ({ name, blob: new Blob([name]) });
const three = [file('a.jpg'), file('b.jpg'), file('c.jpg')];

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('<ExportBar>', () => {
  beforeEach(() => {
    vi.mocked(canSaveToFolder).mockReturnValue(false);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers a single download for one file', async () => {
    const onExport = vi.fn();
    const only = file('photo.webp');
    render(<ExportBar files={[only]} onExport={onExport} />);

    expect(screen.queryByRole('button', { name: /zip/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: strings.download }));

    expect(downloadBlob).toHaveBeenCalledWith(only.blob, 'photo.webp');
    expect(onExport).toHaveBeenCalledWith('single');
  });

  it('offers a ZIP for several files, and a single download only for the selected one', () => {
    const { rerender } = render(<ExportBar files={three} />);
    expect(screen.getByRole('button', { name: 'Download all 3 as ZIP' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: strings.download })).toBeNull();

    rerender(<ExportBar files={three} selected={1} />);
    expect(screen.getByRole('button', { name: strings.download })).toBeTruthy();
  });

  it('shows ZIP progress, then downloads the ZIP', async () => {
    const zip = deferred<Blob>();
    let report: (p: number) => void = () => undefined;
    vi.mocked(zipFiles).mockImplementation((_files, onProgress) => {
      report = onProgress ?? report;
      return zip.promise;
    });
    const onExport = vi.fn();
    render(<ExportBar files={three} zipName="holiday" onExport={onExport} />);

    await userEvent.click(screen.getByRole('button', { name: /as ZIP/ }));
    expect(zipFiles).toHaveBeenCalledWith(three, expect.any(Function));
    act(() => report(0.42));

    const bar = screen.getByRole('progressbar', { name: exportStrings.progressLabel });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText(exportStrings.zipping(42))).toBeTruthy();
    // Nothing can be started twice while the ZIP is being made.
    expect(screen.getByRole('button', { name: /as ZIP/ }).hasAttribute('disabled')).toBe(true);

    const result = new Blob(['zip']);
    await act(async () => {
      zip.resolve(result);
      await zip.promise;
    });

    expect(downloadBlob).toHaveBeenCalledWith(result, 'holiday.zip');
    expect(onExport).toHaveBeenCalledWith('zip');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(exportStrings.zipReady);
  });

  it('shows a plain-language error when the ZIP fails', async () => {
    vi.mocked(zipFiles).mockRejectedValue(new ExportError('zip-too-large'));
    const onExport = vi.fn();
    render(<ExportBar files={three} onExport={onExport} />);

    await userEvent.click(screen.getByRole('button', { name: /as ZIP/ }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      exportStrings.errors['zip-too-large'],
    );
    expect(onExport).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /as ZIP/ }).hasAttribute('disabled')).toBe(false);
  });

  it('uses the generic ZIP error for unexpected failures', async () => {
    vi.mocked(zipFiles).mockRejectedValue(new Error('boom'));
    render(<ExportBar files={three} />);
    await userEvent.click(screen.getByRole('button', { name: /as ZIP/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(exportStrings.errors['zip-failed']);
  });

  it('hides Save to folder where it is not supported (Firefox, Safari)', () => {
    render(<ExportBar files={three} />);
    expect(screen.queryByRole('button', { name: exportStrings.saveToFolder })).toBeNull();
  });

  it('saves to a folder where supported', async () => {
    vi.mocked(canSaveToFolder).mockReturnValue(true);
    vi.mocked(saveToFolder).mockResolvedValue('saved');
    const onExport = vi.fn();
    render(<ExportBar files={three} onExport={onExport} />);

    await userEvent.click(screen.getByRole('button', { name: exportStrings.saveToFolder }));

    expect(saveToFolder).toHaveBeenCalledWith(three, expect.any(Function));
    expect(await screen.findByText(exportStrings.saved(3))).toBeTruthy();
    expect(onExport).toHaveBeenCalledWith('folder');
  });

  it('does nothing when the folder picker is cancelled', async () => {
    vi.mocked(canSaveToFolder).mockReturnValue(true);
    vi.mocked(saveToFolder).mockResolvedValue('cancelled');
    const onExport = vi.fn();
    render(<ExportBar files={three} onExport={onExport} />);

    await userEvent.click(screen.getByRole('button', { name: exportStrings.saveToFolder }));

    expect(onExport).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows an error when saving to the folder fails', async () => {
    vi.mocked(canSaveToFolder).mockReturnValue(true);
    vi.mocked(saveToFolder).mockRejectedValue(new ExportError('save-failed'));
    render(<ExportBar files={three} />);
    await userEvent.click(screen.getByRole('button', { name: exportStrings.saveToFolder }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      exportStrings.errors['save-failed'],
    );
  });

  it('disables every button when there is nothing to export or when disabled', () => {
    vi.mocked(canSaveToFolder).mockReturnValue(true);
    const { rerender } = render(<ExportBar files={[]} />);
    for (const button of screen.getAllByRole('button'))
      expect(button.hasAttribute('disabled')).toBe(true);

    rerender(<ExportBar files={three} disabled />);
    for (const button of screen.getAllByRole('button'))
      expect(button.hasAttribute('disabled')).toBe(true);
  });
});
