// "New version available — Refresh", shown only while no job is running (P21).
// Pure logic; controller.ts wires it to the service worker, the queue and the toaster.

export interface UpdateFlowDeps {
  /** A job is waiting or working: reloading now would lose it. */
  isBusy(): boolean;
  /** Calls `listener` whenever busy may have changed; returns an unsubscribe function. */
  onBusyChange(listener: () => void): () => void;
  /** Shows the update toast; its Refresh button calls `refresh`. */
  show(refresh: () => void): void;
  hide(): void;
  /** Switches to the new version and reloads the page. */
  activate(): void;
}

export interface UpdateFlow {
  /** A new version is installed and waiting. */
  updateReady(): void;
  dispose(): void;
}

export function createUpdateFlow(deps: UpdateFlowDeps): UpdateFlow {
  let ready = false;
  let shown = false;
  let activating = false;

  function sync(): void {
    const want = ready && !activating && !deps.isBusy();
    if (want && !shown) {
      shown = true;
      deps.show(refresh);
    } else if (!want && shown) {
      shown = false;
      deps.hide();
    }
  }

  function refresh(): void {
    // A job may have started since the toast appeared: never reload mid-job.
    if (!ready || activating || deps.isBusy()) {
      sync();
      return;
    }
    activating = true;
    sync();
    deps.activate();
  }

  const unsubscribe = deps.onBusyChange(sync);

  return {
    updateReady() {
      ready = true;
      sync();
    },
    dispose() {
      unsubscribe();
      if (shown) deps.hide();
      shown = false;
    },
  };
}
