import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const URL_ = 'https://crkayes.com/umami';
const WEBSITE = '0f8b5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const ENDPOINT = 'https://crkayes.com/umami/api/send';

const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(new Response('{}')),
);

/** Fresh copy of the module, so it reads the env stubbed for this test. */
async function loadAnalytics(env: { url?: string; website?: string }) {
  vi.stubEnv('VITE_UMAMI_URL', env.url ?? '');
  vi.stubEnv('VITE_UMAMI_WEBSITE_ID', env.website ?? '');
  vi.resetModules();
  return import('./index');
}

/** Lets pending work run (nothing should be sent in the tests that use this alone). */
async function settle() {
  await new Promise((r) => setTimeout(r, 50));
}

/** Waits until the lazily loaded counter has sent exactly `n` requests, and no more follow. */
async function sent(n: number) {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(n), { timeout: 10_000 });
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(n);
}

function sentBodies(): unknown[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as unknown);
}

function setPrivacySignals({ dnt = null as string | null, gpc = false } = {}) {
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => dnt });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => gpc });
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  setPrivacySignals();
  window.history.replaceState(null, '', '/snap-convert/compress-image?secret=1#x');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('track with counting off (env unset)', () => {
  it('sends nothing at all', async () => {
    const { track, countPageView, counterConfig } = await loadAnalytics({});
    track({ name: 'tool-run', tool: 'compress-image', files: 2 });
    track({ name: 'download', tool: 'compress-image', kind: 'zip' });
    countPageView();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(counterConfig()).toBeNull();
  });

  it('is off when only one of the two settings is set', async () => {
    const { track } = await loadAnalytics({ url: URL_ });
    track({ name: 'tool-run', tool: 'compress-image', files: 2 });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('track with counting on', () => {
  it('posts only the allowed fields, only to the configured host', async () => {
    const { track, countPageView, counterConfig } = await loadAnalytics({
      url: URL_,
      website: WEBSITE,
    });
    expect(counterConfig()?.endpoint).toBe(ENDPOINT);

    countPageView();
    track({ name: 'tool-run', tool: 'compress-image', files: 2 });
    track({ name: 'download', tool: 'compress-image', kind: 'zip' });
    await sent(3);
    for (const [input] of fetchMock.mock.calls) expect(input as string).toBe(ENDPOINT);
    const base = {
      website: WEBSITE,
      hostname: window.location.hostname,
      url: '/snap-convert/compress-image',
    };
    expect(sentBodies()).toEqual([
      { type: 'event', payload: base },
      {
        type: 'event',
        payload: { ...base, name: 'tool-run', data: { tool: 'compress-image', files: 2 } },
      },
      {
        type: 'event',
        payload: { ...base, name: 'download', data: { tool: 'compress-image', kind: 'zip' } },
      },
    ]);
  });

  it('sends no cookies, no referrer and nothing cached', async () => {
    const { track } = await loadAnalytics({ url: URL_, website: WEBSITE });
    track({ name: 'tool-run', tool: 'resize-image', files: 1 });
    await sent(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  });

  it('never touches cookies or storage', async () => {
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    const cookieGet = vi.fn(() => '');
    const cookieSet = vi.fn();
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: cookieGet,
      set: cookieSet,
    });
    const storage = [
      vi.spyOn(Storage.prototype, 'getItem'),
      vi.spyOn(Storage.prototype, 'setItem'),
      vi.spyOn(Storage.prototype, 'removeItem'),
    ];
    try {
      const { track, countPageView } = await loadAnalytics({ url: URL_, website: WEBSITE });
      countPageView();
      track({ name: 'download', tool: 'merge-pdf', kind: 'single' });
      await sent(2);
      expect(cookieGet).not.toHaveBeenCalled();
      expect(cookieSet).not.toHaveBeenCalled();
      for (const spy of storage) expect(spy).not.toHaveBeenCalled();
    } finally {
      delete (document as { cookie?: unknown }).cookie;
      if (cookie) Object.defineProperty(Document.prototype, 'cookie', cookie);
    }
  });

  it('drops events with stray fields down to the TrackEvent fields', async () => {
    const { track } = await loadAnalytics({ url: URL_, website: WEBSITE });
    track({ name: 'tool-run', tool: 'compress-image', files: 1, fileName: 'me.jpg' } as never);
    await sent(1);
    expect(JSON.stringify(sentBodies())).not.toContain('me.jpg');
  });

  it('sends nothing when Do Not Track is on', async () => {
    setPrivacySignals({ dnt: '1' });
    const { track, countPageView } = await loadAnalytics({ url: URL_, website: WEBSITE });
    countPageView();
    track({ name: 'tool-run', tool: 'compress-image', files: 2 });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when Global Privacy Control is on', async () => {
    setPrivacySignals({ gpc: true });
    const { track, countPageView } = await loadAnalytics({ url: URL_, website: WEBSITE });
    countPageView();
    track({ name: 'download', tool: 'compress-image', kind: 'single' });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the counter is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { track } = await loadAnalytics({ url: URL_, website: WEBSITE });
    expect(() => track({ name: 'tool-run', tool: 'compress-image', files: 1 })).not.toThrow();
    await sent(1);
  });
});
