/**
 * Root (P10): <html> with the theme script, and the error page. The header/footer frame is the
 * `routes/shell.tsx` layout. Each route sets its own <title>, description and canonical URL (meta.ts).
 */
import type { ReactNode } from 'react';
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from 'react-router';
import { ThemeScript } from '@/ui';
import '../ui/theme.css';
import { ErrorPage } from './components/error-page';
import { Shell } from './components/shell';
import { appStrings } from './strings';
import type { Route } from './+types/root';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Before the styles, so a saved light/dark choice never flashes the wrong theme. */}
        <ThemeScript />
        <Meta />
        <Links />
      </head>
      <body className="flex min-h-dvh flex-col">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function meta({ error }: Route.MetaArgs) {
  return error ? [{ title: appStrings.pageTitle(appStrings.errorTitle) }] : [];
}

/** Friendly page for anything that throws while rendering or loading a route. */
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (!notFound) console.error(error);
  return (
    <Shell>
      {notFound ? (
        <ErrorPage title={appStrings.notFoundTitle} text={appStrings.notFoundText} />
      ) : (
        <ErrorPage title={appStrings.errorTitle} text={appStrings.errorText} reload />
      )}
    </Shell>
  );
}
