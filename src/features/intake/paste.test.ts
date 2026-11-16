import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPasteCount } from './intake';
import { activePasteTarget, filesFromClipboard, registerPasteTarget } from './paste';
import { isApplePlatform } from './platform';

/** A paste event carrying `files` (happy-dom's ClipboardEvent has no clipboardData of its own). */
function pasteEvent(
  files: File[],
  items: Array<{ kind: string; getAsFile: () => File | null }> = [],
) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, items } });
  return event;
}

const cleanups: Array<() => void> = [];
beforeEach(() => resetPasteCount());
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
const register = (fn: (files: File[]) => void) => cleanups.push(registerPasteTarget(fn));

describe('paste target', () => {
  it('sends pasted files to the last registered target only', () => {
    const page = vi.fn();
    const dialog = vi.fn();
    register(page);
    const unregisterDialog = registerPasteTarget(dialog);

    const event = pasteEvent([new File(['x'], 'image.png', { type: 'image/png' })]);
    document.dispatchEvent(event);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    const [files] = dialog.mock.calls[0] as [File[]];
    expect(files[0]?.name).toMatch(/^pasted-\d{4}-\d{2}-\d{2}-1\.png$/);

    unregisterDialog();
    document.dispatchEvent(pasteEvent([new File(['y'], 'notes.pdf')]));
    expect(page).toHaveBeenCalledTimes(1);
    expect((page.mock.calls[0] as [File[]])[0][0]?.name).toBe('notes.pdf');
  });

  it('leaves text pastes alone', () => {
    const target = vi.fn();
    register(target);
    const event = pasteEvent([]);
    document.dispatchEvent(event);
    expect(target).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops listening when nothing is registered', () => {
    const target = vi.fn();
    registerPasteTarget(target)();
    document.dispatchEvent(pasteEvent([new File(['x'], 'a.png')]));
    expect(target).not.toHaveBeenCalled();
    expect(activePasteTarget()).toBeUndefined();
  });

  it('reads clipboard items when files is empty', () => {
    const file = new File(['x'], 'a.png');
    const data = {
      files: [],
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => file },
      ],
    };
    expect(filesFromClipboard(data as unknown as DataTransfer)).toEqual([file]);
    expect(filesFromClipboard(null)).toEqual([]);
  });
});

describe('isApplePlatform', () => {
  it.each([
    [{ platform: 'MacIntel' }, true],
    [{ platform: 'iPhone' }, true],
    [{ userAgentData: { platform: 'macOS' } }, true],
    [{ platform: 'Win32' }, false],
    [{ userAgentData: { platform: 'Android' }, platform: 'Linux armv8l' }, false],
    [{ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }, true],
    [undefined, false],
  ])('%j → %s', (nav, apple) => {
    expect(isApplePlatform(nav)).toBe(apple);
  });
});
