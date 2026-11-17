// Service worker controller (lazy chunk, loaded after hydration by <PwaUpdater/>).
// Registers the service worker, offers updates when no job is running, and explains offline
// failures for tools that were never used online.
import { toast as sonner } from 'sonner';
import { Workbox } from 'workbox-window';
import { useQueue } from '@/core/queue';
import { toast } from '@/ui';
import { browserEngineDeps, checkEngine, engineFor, pageIdFromPath } from './engines';
import { createOfflineNotice, type OfflineNotice } from './offline-notice';
import { pwaStrings } from './strings';
import { createUpdateFlow } from './update-flow';

const BASE = import.meta.env.BASE_URL;
const UPDATE_TOAST = 'pwa-update';
const OFFLINE_TOAST = 'pwa-offline-engine';
/** Look for a new version this often while the app stays open. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export interface PwaController {
  /** The route changed (router path, without the base). */
  setPath(pathname: string): void;
}

function UpdateToast({ refresh }: { refresh: () => void }) {
  return (
    <span className="inline-flex items-center gap-3">
      {pwaStrings.updateReady}
      <button
        type="button"
        onClick={refresh}
        aria-label={pwaStrings.updateRefreshLabel}
        className="cursor-pointer rounded-sm font-semibold underline underline-offset-2"
      >
        {pwaStrings.updateRefresh}
      </button>
    </span>
  );
}

function isBusy(): boolean {
  const { stats } = useQueue.getState();
  return stats.working > 0 || stats.waiting > 0;
}

function startUpdates(): void {
  const wb = new Workbox(`${BASE}sw.js`, { scope: BASE });
  let reloadRequested = false;

  const flow = createUpdateFlow({
    isBusy,
    onBusyChange: (listener) => useQueue.subscribe(listener),
    show: (refresh) =>
      void toast(<UpdateToast refresh={refresh} />, { id: UPDATE_TOAST, duration: Infinity }),
    hide: () => void sonner.dismiss(UPDATE_TOAST),
    activate: () => {
      reloadRequested = true;
      void navigator.serviceWorker
        .getRegistration(BASE)
        .then((reg) => {
          // Waiting worker: let it take over, then reload ('controllerchange' below).
          if (reg?.waiting) wb.messageSkipWaiting();
          // Another tab already switched to the new version: just reload.
          else location.reload();
        })
        .catch(() => location.reload());
    },
  });

  // Fires for an update found now or one that was already waiting when the page opened.
  wb.addEventListener('waiting', () => flow.updateReady());
  // Only the tab whose Refresh was clicked reloads; other tabs keep their work.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) location.reload();
  });

  // Workbox waits for the page's `load` event before registering, so it never competes with it.
  wb.register().catch(() => {
    // No service worker (private mode, blocked, unsupported): the site still works online.
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void wb.update().catch(() => {});
  }, UPDATE_CHECK_MS);
}

function startOfflineNotice(): OfflineNotice {
  const deps = browserEngineDeps(BASE);
  return createOfflineNotice({
    isOnline: () => navigator.onLine,
    onConnectionChange(listener) {
      window.addEventListener('online', listener);
      window.addEventListener('offline', listener);
      return () => {
        window.removeEventListener('online', listener);
        window.removeEventListener('offline', listener);
      };
    },
    async check(pageId) {
      const kind = engineFor(pageId);
      return kind ? checkEngine(kind, deps) : null;
    },
    show: (text) => void toast(text, { id: OFFLINE_TOAST, duration: Infinity }),
    hide: () => void sonner.dismiss(OFFLINE_TOAST),
  });
}

/** Starts once per page load; later calls get the same controller. */
let controller: PwaController | null = null;

export function startPwa(): PwaController {
  if (controller) return controller;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    controller = { setPath() {} };
    return controller;
  }
  startUpdates();
  const notice = startOfflineNotice();
  controller = {
    setPath(pathname) {
      void notice.setPage(pageIdFromPath(pathname));
    },
  };
  return controller;
}
