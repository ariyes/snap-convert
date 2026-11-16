/** Unknown URLs (served from the SPA fallback page). */
import { ErrorPage } from '../components/error-page';
import { pageMeta } from '../meta';
import { appStrings } from '../strings';

export function meta() {
  return pageMeta({
    title: appStrings.pageTitle(appStrings.notFoundTitle),
    description: appStrings.notFoundText,
    noindex: true,
  });
}

export default function NotFound() {
  return <ErrorPage title={appStrings.notFoundTitle} text={appStrings.notFoundText} />;
}
