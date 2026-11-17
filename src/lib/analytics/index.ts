/**
 * Cookie-free usage counting (APP-10, P23): page views, which tool ran with how many files, and
 * which kind of download. Never file names, sizes or contents; no cookies, no storage.
 *
 * Counting is on only when both build-time settings are set (see .env.example):
 *   VITE_UMAMI_URL         base URL of our self-hosted Umami, e.g. https://crkayes.com/umami
 *   VITE_UMAMI_WEBSITE_ID  the website id Umami gives Snap Convert
 * Without them `track()` is a no-op and the counter code isn't even built. With them, nothing is
 * sent when the visitor has Do Not Track or Global Privacy Control on.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import type { Track, TrackEvent } from '@/core/contracts';
import { readCounterConfig, type CounterConfig } from './payload';
import { countingBlocked } from './signals';

// Read straight from import.meta.env so Vite inlines the values at build time. When they are
// unset, `countingConfigured` is the constant `false`, the minifier drops the code below and the counter
// chunk is never emitted, so the app makes no analytics requests and loads no analytics code.
const UMAMI_URL = import.meta.env.VITE_UMAMI_URL as string | undefined;
const UMAMI_WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;

/** True when this build was made with both counting settings (checked further by counterConfig). */
const countingConfigured = !!UMAMI_URL && !!UMAMI_WEBSITE_ID;

/**
 * The counter this build sends to, or null when counting is off (settings unset or invalid).
 * Used by the privacy page to say exactly what this build does.
 */
export function counterConfig(): CounterConfig | null {
  return countingConfigured ? readCounterConfig(UMAMI_URL, UMAMI_WEBSITE_ID) : null;
}

function count(event?: TrackEvent): void {
  if (!countingConfigured) return;
  if (typeof window === 'undefined' || countingBlocked()) return;
  // The page is captured now, not when the counter chunk has loaded.
  const page = { hostname: window.location.hostname, path: window.location.pathname };
  import('./counter')
    .then(({ send }) => send(UMAMI_URL, UMAMI_WEBSITE_ID, event ? { page, event } : { page }))
    .catch(() => {
      // The chunk failed to load (offline): not counted.
    });
}

/** Counts a tool run or a download. Cookie-free; never file names, sizes or contents. */
export const track: Track = (event: TrackEvent): void => count(event);

/** Counts one view of the current page. */
export function countPageView(): void {
  count();
}

/**
 * Counts a page view on first load and after every client-side navigation. Render once, inside
 * the router (the shell layout). Renders nothing.
 */
export function PageViewCounter(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    countPageView();
  }, [pathname]);
  return null;
}
