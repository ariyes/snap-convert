// Mounted once in the root layout (src/app/root.tsx). Kept tiny: it is part of every page's startup
// code. It renders the manifest / favicon / icon / theme-colour tags (React puts them in <head>) and the
// install-prompt catcher, then loads the service worker controller after hydration.
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { ICONS, MANIFEST_FILENAME, THEME_COLOR } from './brand';
import type { PwaController } from './controller';
import { INSTALL_CAPTURE_SCRIPT } from './install';

const BASE = import.meta.env.BASE_URL;

let controller: Promise<PwaController> | null = null;

/** The controller chunk (workbox-window and friends), loaded on first call only. */
function loadController(): Promise<PwaController> {
  controller ??= import('./controller').then((m) => m.startPwa());
  return controller;
}

export function PwaUpdater() {
  const { pathname } = useLocation();

  useEffect(() => {
    // No service worker in development (`pnpm dev`) or tests: it would cache stale modules.
    if (!import.meta.env.PROD) return;
    loadController()
      .then((c) => c.setPath(pathname))
      .catch(() => {
        // Offline before the controller was ever cached, or blocked: the page works without it.
        controller = null;
      });
  }, [pathname]);

  return (
    <>
      <link rel="manifest" href={`${BASE}${MANIFEST_FILENAME}`} />
      <link rel="icon" href={`${BASE}${ICONS.favicon32}`} sizes="32x32" type="image/png" />
      <link rel="icon" href={`${BASE}${ICONS.faviconSvg}`} type="image/svg+xml" />
      <link rel="apple-touch-icon" href={`${BASE}${ICONS.apple}`} />
      <meta name="theme-color" content={THEME_COLOR} />
      <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />
    </>
  );
}
