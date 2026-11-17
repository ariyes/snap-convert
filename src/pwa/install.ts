// "Install app" (Chrome, Edge, Android): the browser's `beforeinstallprompt` event, kept for a
// button in the header. Safari has no such event; iOS users install from the share sheet.
//
// The event can fire before React has hydrated, so a tiny inline script (INSTALL_CAPTURE_SCRIPT,
// rendered by <PwaUpdater/>) catches it during page load and keeps it on `window`.
import { useSyncExternalStore } from 'react';

/** Chromium's install prompt event (not in the DOM typings). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Where the inline script keeps the event, and the event it fires when that changes. */
export const INSTALL_PROMPT_KEY = '__snapConvertInstallPrompt';
export const INSTALL_PROMPT_CHANGED = 'snapconvert:installprompt';

/**
 * Runs in <body> before the app's scripts. `preventDefault` hides Chrome's own mini-infobar; the
 * header button offers the install instead. Cleared once the app is installed.
 */
export const INSTALL_CAPTURE_SCRIPT = `(function(){function s(e){window.${INSTALL_PROMPT_KEY}=e;window.dispatchEvent(new Event('${INSTALL_PROMPT_CHANGED}'))}window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();s(e)});window.addEventListener('appinstalled',function(){s(null)})})();`;

type WithPrompt = Window & { [INSTALL_PROMPT_KEY]?: InstallPromptEvent | null };

function getPrompt(): InstallPromptEvent | null {
  if (typeof window === 'undefined') return null;
  return (window as WithPrompt)[INSTALL_PROMPT_KEY] ?? null;
}

function setPrompt(event: InstallPromptEvent | null): void {
  (window as WithPrompt)[INSTALL_PROMPT_KEY] = event;
  window.dispatchEvent(new Event(INSTALL_PROMPT_CHANGED));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(INSTALL_PROMPT_CHANGED, listener);
  return () => window.removeEventListener(INSTALL_PROMPT_CHANGED, listener);
}

/** True while the browser offers to install the app. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribe, getPrompt, () => null) !== null;
}

/** Shows the browser's install dialog. The event can only be used once, so it is cleared. */
export async function promptInstall(): Promise<void> {
  const event = getPrompt();
  if (!event) return;
  setPrompt(null);
  try {
    await event.prompt();
    await event.userChoice;
  } catch {
    // Dismissed or not allowed any more: nothing to do.
  }
}
