import { CodeXml, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router';
import { Logo, strings, ThemeToggle } from '@/ui';
import { SOURCE_URL } from '../site';
import { appStrings } from '../strings';
import { Container } from './container';
import { lazy, Suspense } from 'react';

// Only shows when the browser offers installation, so it loads after the page is up (startup budget).
const InstallAppButton = lazy(() =>
  import('@/pwa/install-button').then((m) => ({ default: m.InstallAppButton })),
);

const topLink =
  'hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted no-underline hover:bg-sunk hover:text-fg sm:inline-flex';

/** Prototype `header.top`: sticky, translucent, brand on the left, links and theme on the right. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <Container className="flex h-[60px] items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2.5 rounded-md no-underline">
          <Logo />
          <span className="leading-tight">
            <span className="block text-base font-semibold tracking-[-0.01em]">
              {strings.appName}
            </span>
            <span className="block font-mono text-2xs text-faint">{strings.byline}</span>
          </span>
        </Link>
        <nav aria-label={appStrings.mainNav} className="flex items-center gap-1">
          <Link to="/" className={topLink}>
            <LayoutGrid aria-hidden="true" />
            {appStrings.allTools}
          </Link>
          <a href={SOURCE_URL} className={topLink} rel="noopener">
            <CodeXml aria-hidden="true" />
            {appStrings.source}
          </a>
          <Suspense fallback={null}>
            <InstallAppButton />
          </Suspense>
          <ThemeToggle />
        </nav>
      </Container>
    </header>
  );
}
