/**
 * Search content under every tool page (P22): the page's how-to steps and FAQ from the registry.
 * Each tool's own `content.tsx` renders this with its how-to heading.
 *
 * This file has no default export on purpose. It sits at a `content.tsx` path so it stays within
 * P22's files, which puts it in tool-content.tsx's glob under the id `_shared`; no page has that id,
 * so it is never rendered on its own.
 *
 * FAQ answers are native <details> (keyboard and screen-reader friendly, no script), collapsed on
 * every screen so nothing jumps after the page loads. The text is in the pre-rendered HTML either way.
 */
import { ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { containerClass } from '@/features/tool-layout';
import { cn } from '@/lib/utils';
import { getPage } from '../registry';

/** Shared headings (English only at launch, D13). Page-specific headings come from each content.tsx. */
export const seoContentStrings = {
  faqTitle: 'Questions and answers',
} as const;

export interface ToolSeoContentProps {
  /** Registry id of the page (tool or format page). */
  pageId: string;
  /** Heading above the steps, e.g. "How to compress images". */
  howToTitle: string;
}

export function ToolSeoContent({ pageId, howToTitle }: ToolSeoContentProps) {
  const headingId = useId();
  const page = getPage(pageId);
  const howTo = page?.howTo ?? [];
  const faq = page?.faq ?? [];
  if (howTo.length === 0 && faq.length === 0) return null;

  return (
    <section className={cn(containerClass, 'pb-12')} data-testid="tool-seo-content">
      <div className="grid gap-8 border-t border-line pt-8 min-[880px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] min-[880px]:gap-10">
        {howTo.length > 0 && (
          <div>
            <h2 id={`${headingId}-how`} className="m-0 text-lg font-semibold tracking-[-0.01em]">
              {howToTitle}
            </h2>
            <ol
              aria-labelledby={`${headingId}-how`}
              className="m-0 mt-4 flex list-none flex-col gap-3 p-0"
            >
              {howTo.map((step, i) => (
                <li key={step} className="flex gap-3 text-body">
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent"
                  >
                    {i + 1}
                  </span>
                  <span className="pt-px text-pretty">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {faq.length > 0 && (
          <div>
            <h2 id={`${headingId}-faq`} className="m-0 text-lg font-semibold tracking-[-0.01em]">
              {seoContentStrings.faqTitle}
            </h2>
            <div className="mt-4 overflow-hidden rounded-[12px] border border-line bg-card">
              {faq.map((item) => (
                <details key={item.q} className="group border-b border-line last:border-b-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium hover:bg-sunk [&::-webkit-details-marker]:hidden">
                    <span className="text-pretty">{item.q}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 text-muted transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="m-0 px-4 pt-1 pb-4 text-body text-pretty text-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
