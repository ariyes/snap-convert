import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ResetButton, strings as uiStrings, toast } from '@/ui';
import { toolLayoutStrings as strings } from './strings';
import { containerClass } from './tool-page';

/** CSS variable (on <html>) with the height of the fixed phone action bar, 0 when there is none. */
export const ACTION_BAR_HEIGHT_VAR = '--action-bar-height';

export interface WorkspaceProps {
  /** Left column: the files (preview, list…). */
  main: ReactNode;
  /** Panel heading, e.g. "Settings for all files" or <PresetsHeading />. */
  panelTitle: ReactNode;
  /** Shown right under the heading, in the same block (e.g. preset chips). */
  panelIntro?: ReactNode;
  /** The settings controls. */
  panel: ReactNode;
  /** Puts every setting back to its default (APP-12). Shows the Reset button. */
  onReset?: () => void;
  resetDisabled?: boolean;
  /** Show the "Settings reset to defaults" toast after a reset. Default true. */
  announceReset?: boolean;
  /**
   * The primary action(s), e.g. Download. At the bottom of the panel on wide screens; a bar fixed to
   * the bottom of the screen on phones (under 880 px), primary action on the right.
   */
  actions?: ReactNode;
  /** Accessible name of the settings panel. Default "Settings". */
  panelLabel?: string;
  className?: string;
}

/**
 * The one tool layout (D17): files on the left, a 340 px sticky settings panel on the right from
 * 880 px; below that, settings stack under the files and the actions sit in a fixed bottom bar
 * with space reserved for it, so nothing is hidden behind it.
 */
export function Workspace({
  main,
  panelTitle,
  panelIntro,
  panel,
  onReset,
  resetDisabled,
  announceReset = true,
  actions,
  panelLabel = strings.settingsLabel,
  className,
}: WorkspaceProps) {
  const [barRef, barHeight] = useFixedBarHeight(actions !== undefined);
  // A run swaps the action buttons (Merge → Merging… → Download). When the focused one disappears
  // or is disabled, focus moves to the first usable button here, not back to the top of the page.
  const focusedBar = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusedBar.current && document.activeElement === document.body) {
      const next = focusedBar.current.querySelector<HTMLElement>('button:not(:disabled), a[href]');
      next?.focus({ preventScroll: true });
    }
  });

  return (
    <>
      <section
        className={cn(
          containerClass,
          'grid grid-cols-[minmax(0,1fr)] items-start gap-4 pb-6 min-[880px]:grid-cols-[minmax(0,1fr)_340px]',
          className,
        )}
      >
        <div className="min-w-0">{main}</div>
        <aside
          aria-label={panelLabel}
          className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-card p-4 text-fg min-[880px]:sticky min-[880px]:top-[76px]"
        >
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 text-sm font-semibold">{panelTitle}</h2>
              {onReset && (
                <ResetButton
                  disabled={resetDisabled}
                  onClick={() => {
                    onReset();
                    if (announceReset) toast(uiStrings.resetDone, { id: 'settings-reset' });
                  }}
                />
              )}
            </div>
            {panelIntro}
          </div>
          {panel}
          {actions !== undefined && (
            <div
              ref={barRef}
              role="group"
              aria-label={strings.actionsLabel}
              onFocus={(e) => (focusedBar.current = e.currentTarget)}
              onBlur={(e) => {
                const left: Element = e.target;
                // Still there and usable: the user moved focus elsewhere on purpose.
                queueMicrotask(() => {
                  if (left.isConnected && !left.matches(':disabled')) focusedBar.current = null;
                });
              }}
              className={cn(
                'flex flex-col gap-2',
                'max-[880px]:fixed max-[880px]:inset-x-0 max-[880px]:bottom-0 max-[880px]:z-[15] max-[880px]:flex-row-reverse',
                'max-[880px]:border-t max-[880px]:border-line max-[880px]:bg-bg/92 max-[880px]:backdrop-blur-[10px]',
                'max-[880px]:px-4 max-[880px]:pt-3 max-[880px]:pb-[calc(12px+env(safe-area-inset-bottom))]',
                // Phone bar buttons as in the prototype: 40 px tall, sharing the row.
                'max-[880px]:*:h-10 max-[880px]:*:min-w-0 max-[880px]:*:flex-1 max-[880px]:*:px-4 max-[880px]:*:text-body',
              )}
            >
              {actions}
            </div>
          )}
        </aside>
      </section>
      {actions !== undefined && (
        // Keeps the end of the page clear of the fixed bar on phones.
        <div
          aria-hidden="true"
          data-testid="action-bar-spacer"
          className={cn(
            'min-[880px]:hidden',
            barHeight === null && 'h-[calc(73px+env(safe-area-inset-bottom))]',
          )}
          style={barHeight === null ? undefined : { height: barHeight }}
        />
      )}
    </>
  );
}

/**
 * Measures the action bar while it's fixed (phones) and shares the height as a CSS variable on
 * <html>, so the app footer can keep clear of it too.
 */
function useFixedBarHeight(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => {
      const fixed = getComputedStyle(el).position === 'fixed';
      const height = fixed ? Math.ceil(el.getBoundingClientRect().height) : 0;
      setValue(height);
      root.style.setProperty(ACTION_BAR_HEIGHT_VAR, `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty(ACTION_BAR_HEIGHT_VAR);
    };
  }, [enabled]);

  return [ref, value] as const;
}
