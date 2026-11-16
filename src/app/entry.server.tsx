// Build-time renderer for pre-rendered pages (ssr: false, so this never runs on a server).
// Same as React Router's default web entry, except it always waits for all content
// (including lazy/Suspense parts) so every static page is complete for search engines.
// Providing it also stops React Router adding the `isbot` dependency on its own.
// Owned by P10 together with the rest of src/app.
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';
import { renderToReadableStream } from 'react-dom/server';

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  let status = responseStatusCode;
  let shellRendered = false;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        status = 500;
        // Errors before the shell renders are reported by React Router itself.
        if (shellRendered) console.error(error);
      },
    },
  );
  shellRendered = true;

  await body.allReady;

  responseHeaders.set('Content-Type', 'text/html');
  return new Response(body, { headers: responseHeaders, status });
}
