import { describe, expect, it } from 'vitest';
import type { TrackEvent } from '@/core/contracts';
import {
  ALLOWED_DATA_KEYS,
  ALLOWED_PAYLOAD_KEYS,
  eventBody,
  pageViewBody,
  readCounterConfig,
  type CounterConfig,
  type UmamiBody,
} from './payload';

const WEBSITE = '0f8b5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const config: CounterConfig = {
  endpoint: 'https://crkayes.com/umami/api/send',
  website: WEBSITE,
};
const page = { hostname: 'crkayes.com', path: '/snap-convert/compress-image' };

/** Every key anywhere in the body, as dotted paths. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    `${prefix}${k}`,
    ...keyPaths(v, `${prefix}${k}.`),
  ]);
}

/** Fails if the body holds any field that isn't on the allow-list. */
function expectOnlyAllowedFields(body: UmamiBody | null) {
  expect(body).not.toBeNull();
  const allowed = new Set<string>(['type', 'payload']);
  for (const k of ALLOWED_PAYLOAD_KEYS) allowed.add(`payload.${k}`);
  const name = body!.payload.name;
  if (name) for (const k of ALLOWED_DATA_KEYS[name]) allowed.add(`payload.data.${k}`);
  expect(keyPaths(body).filter((k) => !allowed.has(k))).toEqual([]);
}

describe('readCounterConfig', () => {
  it('builds the collect endpoint from the base URL, with or without a trailing slash', () => {
    expect(readCounterConfig('https://crkayes.com/umami', WEBSITE)).toEqual(config);
    expect(readCounterConfig('https://crkayes.com/umami/', ` ${WEBSITE.toUpperCase()} `)).toEqual(
      config,
    );
    expect(readCounterConfig('https://stats.crkayes.com', WEBSITE)?.endpoint).toBe(
      'https://stats.crkayes.com/api/send',
    );
  });

  it('allows plain http only for localhost', () => {
    expect(readCounterConfig('http://localhost:3000', WEBSITE)?.endpoint).toBe(
      'http://localhost:3000/api/send',
    );
    expect(readCounterConfig('http://crkayes.com/umami', WEBSITE)).toBeNull();
  });

  it('is off when a setting is missing or invalid', () => {
    for (const [url, id] of [
      [undefined, WEBSITE],
      ['https://crkayes.com/umami', undefined],
      ['', ''],
      ['https://crkayes.com/umami', 'not-a-uuid'],
      ['not a url', WEBSITE],
      ['ftp://crkayes.com/umami', WEBSITE],
      ['https://user:pass@crkayes.com/umami', WEBSITE],
      ['https://crkayes.com/umami?x=1', WEBSITE],
      ['https://crkayes.com/umami#x', WEBSITE],
    ] as const) {
      expect(readCounterConfig(url, id), `${url} ${id}`).toBeNull();
    }
  });
});

describe('page view body', () => {
  it('sends only the website id, host name and path', () => {
    const body = pageViewBody(config, page);
    expect(body).toEqual({
      type: 'event',
      payload: { website: WEBSITE, hostname: 'crkayes.com', url: '/snap-convert/compress-image' },
    });
    expectOnlyAllowedFields(body);
  });

  it('drops the query string and hash', () => {
    const body = pageViewBody(config, { hostname: 'crkayes.com', path: '/snap-convert/x?a=b#c' });
    expect(body.payload.url).toBe('/snap-convert/x');
  });
});

describe('event body', () => {
  it('tool-run: tool and number of files', () => {
    const body = eventBody(config, page, { name: 'tool-run', tool: 'compress-image', files: 3 });
    expect(body).toEqual({
      type: 'event',
      payload: {
        website: WEBSITE,
        hostname: 'crkayes.com',
        url: '/snap-convert/compress-image',
        name: 'tool-run',
        data: { tool: 'compress-image', files: 3 },
      },
    });
    expectOnlyAllowedFields(body);
  });

  it('download: tool and kind', () => {
    for (const kind of ['single', 'zip', 'folder'] as const) {
      const body = eventBody(config, page, { name: 'download', tool: 'bulk-resize', kind });
      expect(body?.payload.data).toEqual({ tool: 'bulk-resize', kind });
      expect(body?.payload.name).toBe('download');
      expectOnlyAllowedFields(body);
    }
  });

  it('never sends a field that is not in TrackEvent, whatever the caller passes', () => {
    const sneaky = {
      name: 'tool-run',
      tool: 'compress-image',
      files: 2,
      fileName: 'holiday.jpg',
      size: 123456,
      contents: 'data:image/jpeg;base64,AAAA',
      kind: 'zip',
    } as unknown as TrackEvent;
    const body = eventBody(config, page, sneaky);
    expectOnlyAllowedFields(body);
    const json = JSON.stringify(body);
    for (const leak of ['holiday', '123456', 'base64', 'fileName', 'size', 'zip']) {
      expect(json).not.toContain(leak);
    }

    const sneakyDownload = {
      name: 'download',
      tool: 'merge-pdf',
      kind: 'single',
      files: 9,
      names: ['a.pdf'],
    } as unknown as TrackEvent;
    const download = eventBody(config, page, sneakyDownload);
    expectOnlyAllowedFields(download);
    expect(download?.payload.data).toEqual({ tool: 'merge-pdf', kind: 'single' });
  });

  it('refuses events that do not match TrackEvent', () => {
    const bad = [
      { name: 'page-view', tool: 'compress-image', files: 1 },
      { name: 'tool-run', tool: 'holiday photo.jpg', files: 1 },
      { name: 'tool-run', tool: 'C:\\Users\\me\\a.jpg', files: 1 },
      { name: 'tool-run', tool: '', files: 1 },
      { name: 'tool-run', tool: 'compress-image', files: 1.5 },
      { name: 'tool-run', tool: 'compress-image', files: -1 },
      { name: 'tool-run', tool: 'compress-image', files: '3' },
      { name: 'download', tool: 'compress-image', kind: 'holiday.jpg' },
      { name: 'download', tool: 'compress-image' },
    ];
    for (const e of bad) {
      expect(eventBody(config, page, e as unknown as TrackEvent), JSON.stringify(e)).toBeNull();
    }
  });
});
