// While offline on a tool whose engine was never downloaded: "Connect once to download this tool
// (2.1 MB), then it works offline". Pure logic; controller.ts wires it up.
import { formatMegabytes, type EngineStatus } from './engines';
import { pwaStrings } from './strings';

export interface OfflineNoticeDeps {
  isOnline(): boolean;
  /** Calls `listener` on `online` / `offline`; returns an unsubscribe function. */
  onConnectionChange(listener: () => void): () => void;
  /** The engine status for a page, or null when the page isn't a tool. */
  check(pageId: string | undefined): Promise<EngineStatus | null>;
  show(text: string): void;
  hide(): void;
}

export interface OfflineNotice {
  setPage(pageId: string | undefined): Promise<void>;
  dispose(): void;
}

/** The notice text for an engine that isn't cached. */
export function offlineEngineText(status: EngineStatus): string {
  return status.missingBytes
    ? pwaStrings.offlineEngine(formatMegabytes(status.missingBytes))
    : pwaStrings.offlineEngineNoSize;
}

export function createOfflineNotice(deps: OfflineNoticeDeps): OfflineNotice {
  let pageId: string | undefined;
  let shown = false;
  let run = 0;

  const hide = () => {
    if (shown) deps.hide();
    shown = false;
  };

  async function update(): Promise<void> {
    const current = ++run;
    if (deps.isOnline()) return hide();
    const status = await deps.check(pageId).catch(() => null);
    // The page or the connection changed while checking: a newer update decides.
    if (current !== run) return;
    if (!status || status.cached || deps.isOnline()) return hide();
    shown = true;
    deps.show(offlineEngineText(status));
  }

  const unsubscribe = deps.onConnectionChange(() => void update());

  return {
    setPage(id) {
      pageId = id;
      return update();
    },
    dispose() {
      unsubscribe();
      run++;
      hide();
    },
  };
}
