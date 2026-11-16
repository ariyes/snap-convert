import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from './hooks/use-theme';
import { themeScript } from './theme-script';

/** Runs the snippet the way the root layout does: as an inline <script>. */
function runInlineScript() {
  const script = document.createElement('script');
  script.textContent = themeScript;
  document.head.append(script);
  script.remove();
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('themeScript', () => {
  it('applies a stored light or dark choice before React loads', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runInlineScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runInlineScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('leaves the device setting in charge for anything else', () => {
    runInlineScript();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    localStorage.setItem(THEME_STORAGE_KEY, '"><img src=x>');
    runInlineScript();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
