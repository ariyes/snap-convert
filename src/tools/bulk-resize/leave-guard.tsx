// Warns before leaving the page while results exist only in memory (not downloaded yet) or work is
// still running: the browser's own prompt for reloads and closing the tab, and a small dialog for
// links inside the app.

import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { useBlocker } from 'react-router';
import { Button } from '@/ui';
import { bulkStrings as t } from './strings';

export interface LeaveGuardProps {
  /** null: nothing to lose, leave freely. */
  reason: 'unsaved' | 'running' | null;
}

export function LeaveGuard({ reason }: LeaveGuardProps) {
  const active = reason !== null;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      active && currentLocation.pathname !== nextLocation.pathname,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);

  const blocked = blocker.state === 'blocked';
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (blocked && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // Staying is the safe choice, so it gets the focus.
      stayRef.current?.focus();
    } else if (!blocked && dialog.open) {
      dialog.close();
    }
  }, [blocked]);

  // Nothing to lose any more (e.g. the run finished and was downloaded): let a waiting move go.
  useEffect(() => {
    if (blocker.state === 'blocked' && !active) blocker.proceed();
  }, [blocker, active]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(event) => {
        event.preventDefault();
        if (blocker.state === 'blocked') blocker.reset();
      }}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-card border border-line bg-card p-5 text-fg shadow-raised backdrop:bg-scrim"
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-warn-bg text-warn"
        >
          <TriangleAlert className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={titleId} className="m-0 text-base font-semibold">
            {t.leaveTitle}
          </h2>
          <p id={textId} className="m-0 text-sm text-muted">
            {reason === 'running' ? t.leaveRunning : t.leaveUnsaved}
          </p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={() => blocker.state === 'blocked' && blocker.proceed()}>{t.leave}</Button>
        <Button
          ref={stayRef}
          variant="primary"
          onClick={() => blocker.state === 'blocked' && blocker.reset()}
        >
          {t.stay}
        </Button>
      </div>
    </dialog>
  );
}
