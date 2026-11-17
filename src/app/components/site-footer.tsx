import { Link } from 'react-router';
import { CRKAYES_URL, SOURCE_URL } from '../site';
import { appStrings } from '../strings';
import { Container } from './container';

const footerLink = 'rounded-sm no-underline hover:text-fg';

/**
 * Bottom padding under 880 px: the prototype's 96 px, or more when a tool's fixed action bar
 * (P13 `Workspace`, which sets `--action-bar-height` on <html>) is taller, so it never covers the footer.
 */
const phonePadding = 'max-[880px]:pb-[max(96px,calc(var(--action-bar-height,0px)_+_24px))]';

/** Prototype `footer`: licence notice and links. */
export function SiteFooter() {
  return (
    <footer
      className={`mt-auto border-t border-line pt-6 pb-24 text-ui text-muted ${phonePadding}`}
    >
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
