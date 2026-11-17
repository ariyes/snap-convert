import { describe, expect, it, vi } from 'vitest';
import { createUpdateFlow, type UpdateFlowDeps } from './update-flow';

function setup(initialBusy = false) {
  let busy = initialBusy;
  const listeners = new Set<() => void>();
  let refresh: (() => void) | null = null;
  const deps = {
    isBusy: () => busy,
    onBusyChange: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    show: vi.fn((r: () => void) => {
      refresh = r;
    }),
    hide: vi.fn(),
    activate: vi.fn(),
  } satisfies UpdateFlowDeps;
  const flow = createUpdateFlow(deps);
  return {
    flow,
    deps,
    setBusy(value: boolean) {
      busy = value;
      listeners.forEach((l) => l());
    },
    clickRefresh() {
      if (!refresh) throw new Error('toast not shown');
      refresh();
    },
    listenerCount: () => listeners.size,
  };
}

describe('update flow', () => {
  it('shows nothing until a new version is waiting', () => {
    const t = setup();
    t.setBusy(true);
    t.setBusy(false);
    expect(t.deps.show).not.toHaveBeenCalled();
  });

  it('shows the toast once when an update is ready and nothing is running', () => {
    const t = setup();
    t.flow.updateReady();
    t.flow.updateReady();
    expect(t.deps.show).toHaveBeenCalledTimes(1);
  });

  it('waits for running jobs to finish before offering the update', () => {
    const t = setup(true);
    t.flow.updateReady();
    expect(t.deps.show).not.toHaveBeenCalled();
    t.setBusy(false);
    expect(t.deps.show).toHaveBeenCalledTimes(1);
  });

  it('hides the toast while a job runs and brings it back afterwards', () => {
    const t = setup();
    t.flow.updateReady();
    t.setBusy(true);
    expect(t.deps.hide).toHaveBeenCalledTimes(1);
    t.setBusy(false);
    expect(t.deps.show).toHaveBeenCalledTimes(2);
  });

  it('never reloads mid-job, even if Refresh is clicked as a job starts', () => {
    const t = setup();
    t.flow.updateReady();
    // The job starts in the same tick as the click, before the busy listener has run.
    const busyNow = t.deps.isBusy;
    t.deps.isBusy = () => true;
    t.clickRefresh();
    expect(t.deps.activate).not.toHaveBeenCalled();
    t.deps.isBusy = busyNow;
  });

  it('switches to the new version when Refresh is clicked while idle', () => {
    const t = setup();
    t.flow.updateReady();
    t.clickRefresh();
    expect(t.deps.activate).toHaveBeenCalledTimes(1);
    expect(t.deps.hide).toHaveBeenCalledTimes(1);
    // A second click (or a later busy change) doesn't activate twice or show the toast again.
    t.clickRefresh();
    t.setBusy(true);
    t.setBusy(false);
    expect(t.deps.activate).toHaveBeenCalledTimes(1);
    expect(t.deps.show).toHaveBeenCalledTimes(1);
  });

  it('dispose removes the toast and stops listening', () => {
    const t = setup();
    t.flow.updateReady();
    t.flow.dispose();
    expect(t.deps.hide).toHaveBeenCalledTimes(1);
    expect(t.listenerCount()).toBe(0);
  });
});
