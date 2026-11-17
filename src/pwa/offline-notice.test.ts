import { describe, expect, it, vi } from 'vitest';
import type { EngineStatus } from './engines';
import { createOfflineNotice, offlineEngineText, type OfflineNoticeDeps } from './offline-notice';

function setup(status: EngineStatus | null, online = false) {
  let isOnline = online;
  const listeners = new Set<() => void>();
  const deps = {
    isOnline: () => isOnline,
    onConnectionChange: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    check: vi.fn((_pageId: string | undefined) => Promise.resolve(status)),
    show: vi.fn(),
    hide: vi.fn(),
  } satisfies OfflineNoticeDeps;
  const notice = createOfflineNotice(deps);
  return {
    notice,
    deps,
    async setOnline(value: boolean) {
      isOnline = value;
      listeners.forEach((l) => l());
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const missing: EngineStatus = { cached: false, missingBytes: 2_100_000 };

describe('offline engine notice', () => {
  it('says how much to download, in MB', () => {
    expect(offlineEngineText(missing)).toBe(
      'Connect once to download this tool (up to 2.1 MB), then it works offline',
    );
    expect(offlineEngineText({ cached: false, missingBytes: null })).toBe(
      'Connect once to download this tool, then it works offline',
    );
  });

  it('shows for a never-used tool while offline', async () => {
    const t = setup(missing);
    await t.notice.setPage('merge-pdf');
    expect(t.deps.check).toHaveBeenCalledWith('merge-pdf');
    expect(t.deps.show).toHaveBeenCalledWith(
      'Connect once to download this tool (up to 2.1 MB), then it works offline',
    );
  });

  it('stays quiet online, on non-tool pages and for tools used before', async () => {
    const online = setup(missing, true);
    await online.notice.setPage('merge-pdf');
    expect(online.deps.show).not.toHaveBeenCalled();
    expect(online.deps.check).not.toHaveBeenCalled();

    const home = setup(null);
    await home.notice.setPage(undefined);
    expect(home.deps.show).not.toHaveBeenCalled();

    const used = setup({ cached: true, missingBytes: 0 });
    await used.notice.setPage('compress-image');
    expect(used.deps.show).not.toHaveBeenCalled();
  });

  it('appears when the connection drops and goes when it comes back', async () => {
    const t = setup(missing, true);
    await t.notice.setPage('merge-pdf');
    await t.setOnline(false);
    expect(t.deps.show).toHaveBeenCalledTimes(1);
    await t.setOnline(true);
    expect(t.deps.hide).toHaveBeenCalledTimes(1);
  });

  it('hides when moving to a page that needs no notice', async () => {
    let status: EngineStatus | null = missing;
    const t = setup(null);
    t.deps.check.mockImplementation(() => Promise.resolve(status));
    await t.notice.setPage('merge-pdf');
    status = null;
    await t.notice.setPage(undefined);
    expect(t.deps.hide).toHaveBeenCalledTimes(1);
  });

  it('ignores a slow check for a page the user already left', async () => {
    const t = setup(null);
    let release: (s: EngineStatus) => void = () => {};
    t.deps.check.mockImplementationOnce(
      () => new Promise<EngineStatus>((resolve) => (release = resolve)),
    );
    const first = t.notice.setPage('merge-pdf');
    await t.notice.setPage(undefined);
    release(missing);
    await first;
    expect(t.deps.show).not.toHaveBeenCalled();
  });
});
