import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

// sonner (~9 KiB gzip) loads after the page is up, not with it (startup budget, P24).
// Toasts shown before it arrives are queued by sonner and appear once <Toaster/> mounts.
const load = () => import('./toaster-impl');

/** Put once in the root layout (P10). Toasts are announced politely to screen readers. */
export function Toaster() {
  const [Impl, setImpl] = useState<ComponentType | null>(null);
  useEffect(() => {
    void load().then((m) => setImpl(() => m.ToasterImpl));
  }, []);
  return Impl ? <Impl /> : null;
}

export interface ToastOptions {
  /** Milliseconds; default 2.6 s. */
  duration?: number;
  /** Reuse an id to replace a toast instead of adding another. */
  id?: string;
}

let count = 0;

/** Shows a short message at the bottom of the screen (prototype `#toast`). Returns its id. */
export function toast(message: ReactNode, options: ToastOptions = {}): string {
  const id = options.id ?? `toast-${++count}`;
  void load().then((m) => m.showToast(message, { ...options, id }));
  return id;
}
