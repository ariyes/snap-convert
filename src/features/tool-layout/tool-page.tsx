import { ChevronRight, ShieldCheck, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ToolMeta } from '@/core/contracts/tools';
import { cn } from '@/lib/utils';
import { Button } from '@/ui';
import { toolLayoutStrings as strings } from './strings';

/** Prototype `.container`: centred, 1120 px wide, 16 px gutters (24 px from 640 px). */
export const containerClass = 'mx-auto w-full max-w-[1120px] px-4 sm:px-6';

export interface ToolPageProps {
  /** Name (title), group (breadcrumb) and short line (description) of the tool. */
  meta: Pick<ToolMeta, 'name' | 'group' | 'short'>;
  /** Replaces `meta.short` under the title. */
  description?: ReactNode;
  /** True once the user has added files: shows `workspace` instead of `empty`. */
  hasFiles?: boolean;
  /** Shown before any files are added, usually a <ToolEmptyState>. */
  empty?: ReactNode;
  /** Shown once files are added, usually a <Workspace>. */
  workspace?: ReactNode;
  /** Shown after the empty state or workspace (e.g. help text for search engines). */
  children?: ReactNode;
}

/**
 * The frame of every tool page (D17): breadcrumb, title, short description and the privacy line
 * (APP-06), then the empty state or the workspace.
 */
export function ToolPage({
  meta,
  description,
  hasFiles = false,
  empty,
  workspace,
  children,
}: ToolPageProps) {
  return (
    <>
      <section className={cn(containerClass, 'pt-6 pb-5')}>
        <nav aria-label={strings.breadcrumb}>
          <ol className="m-0 mb-2.5 flex list-none items-center gap-1.5 p-0 text-ui text-faint">
            <li>
              <Link to="/" className="no-underline hover:text-fg">
                {strings.allTools}
              </Link>
            </li>
            <li aria-hidden="true" className="flex">
              <ChevronRight className="size-3.5" />
            </li>
            <li>{meta.group}</li>
          </ol>
        </nav>
        <h1 className="m-0 max-w-[760px] text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[34px]">
          {meta.name}
        </h1>
        <p className="m-0 mt-1.5 max-w-[620px] text-body text-pretty text-muted">
          {description ?? meta.short}
        </p>
        <p className="m-0 mt-3 inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-2.5 py-[3px] text-xs text-ok">
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          {strings.privacyLine}
        </p>
      </section>
      {hasFiles ? workspace : empty}
      {children}
    </>
  );
}

export interface ToolEmptyStateProps {
  /** The drop zone (P11's <DropZone>). */
  dropZone: ReactNode;
  /** Button text, e.g. "Try with a sample photo". Default "Try with a sample". */
  sampleLabel?: string;
  /** Adds the sample button. */
  onSample?: () => void;
  /** While the sample is being made: the button is disabled and says so. */
  sampleBusy?: boolean;
}

/** Before any files: the drop zone and a "Try with a sample" button under it. */
export function ToolEmptyState({
  dropZone,
  sampleLabel = strings.trySample,
  onSample,
  sampleBusy = false,
}: ToolEmptyStateProps) {
  return (
    <section className={cn(containerClass, 'pb-12')}>
      {dropZone}
      {onSample && (
        <div className="mt-3 text-center">
          <Button variant="ghost" onClick={onSample} disabled={sampleBusy}>
            <Sparkles aria-hidden="true" />
            {sampleBusy ? strings.makingSample : sampleLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
