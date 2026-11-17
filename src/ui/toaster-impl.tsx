// sonner, loaded after the page is up by ./toaster.tsx (keeps it out of the startup bundle, P24).
import type { CSSProperties, ReactNode } from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import type { ToastOptions } from './toaster';

/** How long a toast stays, as in the prototype. */
const DURATION_MS = 2600;

// --toast-bottom (theme.css) is 24 px, or 136 px on phones so toasts clear the fixed action bar.
const offset = { bottom: 'var(--toast-bottom)' };
const mobileOffset = { bottom: 'var(--toast-bottom)', left: '16px', right: '16px' };
const style = { '--width': 'min(560px, calc(100vw - 32px))' } as CSSProperties;

export function ToasterImpl() {
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

export function showToast(message: ReactNode, options: ToastOptions & { id: string }): void {
  sonnerToast.custom(
    () => (
      <div className="max-w-full rounded-control bg-fg px-4 py-2.5 text-center font-sans text-sm text-bg">
        {message}
      </div>
    ),
    { duration: options.duration ?? DURATION_MS, id: options.id },
  );
}
