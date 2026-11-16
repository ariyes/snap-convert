import type { CSSProperties, ReactNode } from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

/** How long a toast stays, as in the prototype. */
const DURATION_MS = 2600;

// --toast-bottom (theme.css) is 24 px, or 136 px on phones so toasts clear the fixed action bar.
const offset = { bottom: 'var(--toast-bottom)' };
const mobileOffset = { bottom: 'var(--toast-bottom)', left: '16px', right: '16px' };
const style = { '--width': 'min(560px, calc(100vw - 32px))' } as CSSProperties;

/** Put once in the root layout (P10). Toasts are announced politely to screen readers. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      offset={offset}
      mobileOffset={mobileOffset}
      visibleToasts={3}
      gap={8}
      style={style}
      toastOptions={{
        unstyled: true,
        duration: DURATION_MS,
        // The list item only centres the bubble; the bubble itself is drawn in toast().
        classNames: { toast: 'flex w-full justify-center' },
      }}
    />
  );
}

export interface ToastOptions {
  /** Milliseconds; default 2.6 s. */
  duration?: number;
  /** Reuse an id to replace a toast instead of adding another. */
  id?: string;
}

/** Shows a short message at the bottom of the screen (prototype `#toast`). */
export function toast(message: ReactNode, options: ToastOptions = {}): string | number {
  return sonnerToast.custom(
    () => (
      <div className="max-w-full rounded-control bg-fg px-4 py-2.5 text-center font-sans text-sm text-bg">
        {message}
      </div>
    ),
    { duration: options.duration ?? DURATION_MS, id: options.id },
  );
}
