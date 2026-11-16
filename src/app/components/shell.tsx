import type { ReactNode } from 'react';
import { Toaster } from '@/ui';
import { appStrings } from '../strings';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

/** Skip link, header, main area, footer and toasts around every app page and the error page. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-control bg-accent px-4 py-2 font-medium text-on-accent no-underline focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {appStrings.skipToContent}
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <SiteFooter />
      <Toaster />
    </>
  );
}
