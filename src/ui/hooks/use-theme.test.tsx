import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The theme store is module state, so each test loads fresh modules.
async function load() {
  vi.resetModules();
  const hook = await import('./use-theme');
  const { ThemeToggle } = await import('../theme-toggle');
  return { ...hook, ThemeToggle };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('nextTheme', () => {
  it('cycles system → light → dark → system', async () => {
    const { nextTheme } = await load();
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});

describe('ThemeToggle / useTheme', () => {
  it('cycles the theme, sets data-theme on <html> and stores the choice', async () => {
    const { ThemeToggle, THEME_STORAGE_KEY } = await load();
    const user = userEvent.setup();
    render(<ThemeToggle announce={false} />);
    const root = document.documentElement;

    expect(screen.getByRole('button', { name: /Theme: follow device/ })).toBeTruthy();
    expect(root.hasAttribute('data-theme')).toBe(false);

    await user.click(screen.getByRole('button'));
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('button', { name: /Theme: light/ })).toBeTruthy();

    await user.click(screen.getByRole('button'));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('button'));
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: /Theme: follow device/ })).toBeTruthy();
  });

  it('starts from the stored choice', async () => {
    localStorage.setItem('snapconvert:theme', 'dark');
    const { ThemeToggle } = await load();
    render(<ThemeToggle announce={false} />);
    expect(screen.getByRole('button', { name: /Theme: dark/ })).toBeTruthy();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores an invalid stored value', async () => {
    localStorage.setItem('snapconvert:theme', 'purple');
    const { ThemeToggle } = await load();
    render(<ThemeToggle announce={false} />);
    expect(screen.getByRole('button', { name: /Theme: follow device/ })).toBeTruthy();
  });

  it('works when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { ThemeToggle } = await load();
    const user = userEvent.setup();
    render(<ThemeToggle announce={false} />);
    await user.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('button', { name: /Theme: light/ })).toBeTruthy();
  });

  it('keeps every caller in sync', async () => {
    const { ThemeToggle, setTheme } = await load();
    render(
      <>
        <ThemeToggle announce={false} />
        <ThemeToggle announce={false} />
      </>,
    );
    act(() => setTheme('dark'));
    expect(screen.getAllByRole('button', { name: /Theme: dark/ })).toHaveLength(2);
  });
});
