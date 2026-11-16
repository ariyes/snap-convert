import { Link } from 'react-router';
import { CRKAYES_URL, SOURCE_URL } from '../site';
import { appStrings } from '../strings';
import { Container } from './container';

const footerLink = 'rounded-sm no-underline hover:text-fg';

/** Prototype `footer`: licence notice and links. Bottom padding leaves room for the phone action bar. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line pt-6 pb-24 text-ui text-muted">
      <Container className="flex flex-wrap justify-between gap-x-5 gap-y-2">
        <p className="m-0">{appStrings.footerNotice}</p>
        <nav aria-label={appStrings.footerNav} className="flex flex-wrap gap-x-4 gap-y-1.5">
          <a href={SOURCE_URL} className={footerLink} rel="noopener">
            {appStrings.sourceCode}
          </a>
          <Link to="/credits" className={footerLink}>
            {appStrings.credits}
          </Link>
          <Link to="/privacy" className={footerLink}>
            {appStrings.privacy}
          </Link>
          <a href={CRKAYES_URL} className={footerLink} rel="noopener">
            {appStrings.crkayes}
          </a>
        </nav>
      </Container>
    </footer>
  );
}
