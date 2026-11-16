import { THEME_STORAGE_KEY } from './hooks/use-theme';

/**
 * Runs in <head> before the page paints, so a saved light/dark choice never flashes the wrong theme.
 * Static text with no user data; safe to inline.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;

/** Put inside <head> in the root layout (P10). */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
