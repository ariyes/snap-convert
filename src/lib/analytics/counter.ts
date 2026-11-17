/**
 * The cookie-free counter itself. Loaded on demand by ./index.ts (a separate chunk from our own
 * domain), and only when counting is configured and the visitor hasn't asked not to be tracked.
 *
 * Instead of Umami's tracker script (which also sends screen size, language, referrer and page
 * title, and reads localStorage), this posts the allow-listed fields from ./payload.ts straight to
 * Umami's collect endpoint. No cookies (`credentials: 'omit'`), no Referer header, no storage.
 */
import type { TrackEvent } from '@/core/contracts';
import {
  eventBody,
  pageViewBody,
  readCounterConfig,
  type PageRef,
  type UmamiBody,
} from './payload';

export interface Hit {
  page: PageRef;
  /** Absent for a page view. */
  event?: TrackEvent;
}

export function bodyFor(url: unknown, website: unknown, hit: Hit) {
  const config = readCounterConfig(url, website);
  if (!config) return null;
  const body: UmamiBody | null = hit.event
    ? eventBody(config, hit.page, hit.event)
    : pageViewBody(config, hit.page);
  return body && { endpoint: config.endpoint, body };
}

/** Sends one hit. Never throws: a blocked or failed count is simply not counted. */
export async function send(url: unknown, website: unknown, hit: Hit): Promise<void> {
  const request = bodyFor(url, website, hit);
  if (!request) return;
  try {
    await fetch(request.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      keepalive: true,
    });
  } catch {
    // Offline, blocked by an extension, or the counter is down: nothing to do.
  }
}
