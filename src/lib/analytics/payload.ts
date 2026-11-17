/**
 * What the counter sends, built field by field from an allow-list. Nothing from the caller is
 * copied wholesale, so a stray property (a file name, a size) can never reach the network.
 * Format: Umami's `/api/send` (https://umami.is/docs/api/sending-stats).
 */
import type { TrackEvent } from '@/core/contracts';

/** Where and as whom to count. Built from the build-time environment by `readCounterConfig`. */
export interface CounterConfig {
  /** Full URL of Umami's collect endpoint, e.g. `https://crkayes.com/umami/api/send`. */
  endpoint: string;
  /** Umami website id (a UUID). */
  website: string;
}

/** The page a hit belongs to: host name and path only (never the query string or hash). */
export interface PageRef {
  hostname: string;
  path: string;
}

/** Event data, exactly the fields of `TrackEvent` minus `name`. */
export type EventData = { tool: string; files: number } | { tool: string; kind: DownloadKind };
type DownloadKind = Extract<TrackEvent, { name: 'download' }>['kind'];

export interface UmamiBody {
  type: 'event';
  payload: {
    website: string;
    hostname: string;
    url: string;
    /** Absent for a page view. */
    name?: TrackEvent['name'];
    data?: EventData;
  };
}

/** Every key the counter may ever send (tests hold the code to this list). */
export const ALLOWED_PAYLOAD_KEYS = ['website', 'hostname', 'url', 'name', 'data'] as const;
export const ALLOWED_DATA_KEYS = { 'tool-run': ['tool', 'files'], download: ['tool', 'kind'] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tool ids are registry slugs (`compress-image`); anything else is refused. */
const TOOL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOWNLOAD_KINDS: readonly string[] = ['single', 'zip', 'folder'] satisfies DownloadKind[];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Checks the two build-time settings. Returns null (counting off) unless both are valid: an
 * https URL (http only for localhost) without credentials, query or hash, and a UUID website id.
 */
export function readCounterConfig(url: unknown, website: unknown): CounterConfig | null {
  if (typeof url !== 'string' || typeof website !== 'string') return null;
  const id = website.trim();
  if (!UUID.test(id)) return null;
  let base: URL;
  try {
    base = new URL(url.trim());
  } catch {
    return null;
  }
  const secure =
    base.protocol === 'https:' || (base.protocol === 'http:' && LOCAL_HOSTS.has(base.hostname));
  if (!secure || base.username || base.password || base.search || base.hash) return null;
  const dir = base.href.endsWith('/') ? base.href : `${base.href}/`;
  return { endpoint: new URL('api/send', dir).href, website: id.toLowerCase() };
}

/** Path only, with the query string and hash removed. */
function cleanPath(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? '';
  return bare.startsWith('/') ? bare.slice(0, 200) : '/';
}

function base(config: CounterConfig, page: PageRef): UmamiBody['payload'] {
  return {
    website: config.website,
    hostname: page.hostname.slice(0, 100),
    url: cleanPath(page.path),
  };
}

export function pageViewBody(config: CounterConfig, page: PageRef): UmamiBody {
  return { type: 'event', payload: base(config, page) };
}

/**
 * Body for a `track()` event, or null if the event doesn't match `TrackEvent` exactly enough to be
 * safe (unknown name, a tool that isn't a slug, a file count that isn't a whole number, …).
 */
export function eventBody(
  config: CounterConfig,
  page: PageRef,
  event: TrackEvent,
): UmamiBody | null {
  const e = event as Partial<Record<string, unknown>>;
  if (typeof e.tool !== 'string' || e.tool.length > 50 || !TOOL_ID.test(e.tool)) return null;
  const tool = e.tool;
  let data: EventData;
  if (e.name === 'tool-run') {
    const files = e.files;
    if (typeof files !== 'number' || !Number.isSafeInteger(files) || files < 0) return null;
    data = { tool, files };
  } else if (e.name === 'download') {
    if (typeof e.kind !== 'string' || !DOWNLOAD_KINDS.includes(e.kind)) return null;
    data = { tool, kind: e.kind as DownloadKind };
  } else {
    return null;
  }
  return { type: 'event', payload: { ...base(config, page), name: e.name, data } };
}
