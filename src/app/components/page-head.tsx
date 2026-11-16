import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { PageMeta } from '@/tools/registry';
import { appStrings } from '../strings';
import { Container } from './container';

/**
 * Prototype `.page-head` for the shell's own tool pages (placeholders, "Coming soon").
 * Real tool pages use P13's <ToolPage>.
 */
export function PageHead({ page, badge }: { page: PageMeta; badge?: ReactNode }) {
  return (
    <Container className="pt-6 pb-5">
      <nav aria-label={appStrings.breadcrumb} className="mb-2.5 text-ui text-faint">
        <ol className="m-0 flex list-none items-center gap-1.5 p-0">
          <li>
            <Link to="/" className="rounded-sm no-underline hover:text-fg">
              {appStrings.allTools}
            </Link>
          </li>
          <li aria-hidden="true" className="flex">
            <ChevronRight className="size-3.5" />
          </li>
          <li>{page.group}</li>
        </ol>
      </nav>
      <h1 className="m-0 flex flex-wrap items-center gap-3 text-[28px] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[34px]">
        {page.name}
        {badge}
      </h1>
      <p className="mt-1.5 mb-0 max-w-[620px] text-body text-muted">{page.short}</p>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-2.5 py-[3px] text-xs text-ok">
        <ShieldCheck aria-hidden="true" className="size-3.5" />
        {appStrings.privacyLine}
      </span>
    </Container>
  );
}
