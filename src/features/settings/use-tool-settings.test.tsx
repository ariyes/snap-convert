import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { numberIn } from './schema';
import { clearSettingsMemory } from './storage';
import { settingsKey, useToolSettings } from './use-tool-settings';

const DEFAULTS = { quality: 80, strip: true, preset: null as string | null };
const KEY = settingsKey('test-tool');

beforeEach(() => {
  localStorage.clear();
  clearSettingsMemory();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Like a page reload: forget the session copy so settings are read from storage again. */
function reload() {
  cleanup();
  clearSettingsMemory();
}

describe('settingsKey', () => {
  it('is versioned per tool', () => {
    expect(settingsKey('compress-image')).toBe('snapconvert:settings:compress-image:v1');
  });
});

describe('useToolSettings', () => {
  it('starts with the defaults', () => {
    const { result } = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('saves updates and remembers them after a reload', () => {
    const first = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    act(() => first.result.current[1]({ quality: 60 }));
    expect(first.result.current[0]).toEqual({ ...DEFAULTS, quality: 60 });
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({ quality: 60 });

    reload();
    const second = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    expect(second.result.current[0].quality).toBe(60);
  });

  it('keeps settings separate per tool', () => {
    const a = renderHook(() => useToolSettings('tool-a', DEFAULTS));
    const b = renderHook(() => useToolSettings('tool-b', DEFAULTS));
    act(() => a.result.current[1]({ quality: 30 }));
    expect(a.result.current[0].quality).toBe(30);
    expect(b.result.current[0].quality).toBe(80);
  });

  it('applies several updates in a row', () => {
    const { result } = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    act(() => {
      result.current[1]({ quality: 50 });
      result.current[1]({ strip: false });
    });
    expect(result.current[0]).toEqual({ ...DEFAULTS, quality: 50, strip: false });
  });

  it('falls back to the defaults for corrupt stored JSON', () => {
    localStorage.setItem(KEY, '{"quality": 6');
    const { result } = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it('falls back per key for invalid or unknown stored values', () => {
    localStorage.setItem(KEY, JSON.stringify({ quality: 500, strip: 'no', preset: 'blog', x: 1 }));
    const { result } = renderHook(() =>
      useToolSettings('test-tool', DEFAULTS, { quality: numberIn(10, 100) }),
    );
    expect(result.current[0]).toEqual({ ...DEFAULTS, preset: 'blog' });
  });

  it('reset restores the defaults, clears the preset and forgets the stored value', () => {
    const { result } = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    act(() => result.current[1]({ quality: 40, preset: 'wordpress' }));
    act(() => result.current[2]());
    expect(result.current[0]).toEqual(DEFAULTS);
    expect(result.current[0].preset).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();

    reload();
    const again = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    expect(again.result.current[0]).toEqual(DEFAULTS);
  });

  it('works without storage (private window, blocked or full) for the session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const { result } = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
    act(() => result.current[1]({ quality: 55 }));
    expect(result.current[0].quality).toBe(55);
    act(() => result.current[2]());
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it('shares one value between components of the same tool', async () => {
    function Control() {
      const [s, update] = useToolSettings('test-tool', DEFAULTS);
      return (
        <button type="button" onClick={() => update({ quality: s.quality - 10 })}>
          lower
        </button>
      );
    }
    function Display() {
      const [s] = useToolSettings('test-tool', DEFAULTS);
      return <output>{s.quality}</output>;
    }
    render(
      <>
        <Control />
        <Display />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'lower' }));
    expect(screen.getByRole('status').textContent).toBe('70');
  });

  it('follows changes made in another tab', () => {
    const { result } = renderHook(() => useToolSettings('test-tool', DEFAULTS));
    const newValue = JSON.stringify({ quality: 33 });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue }));
    });
    expect(result.current[0].quality).toBe(33);
  });
});
