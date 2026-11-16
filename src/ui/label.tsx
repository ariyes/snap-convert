import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Prototype `.label` / `.field label`: the small muted label above a control. */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- callers pass htmlFor or wrap the control
    <label className={cn('text-ui font-medium text-muted', className)} {...props} />
  );
}

/** Prototype `.helper`: small faint text under a control. */
export function Helper({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('m-0 text-xs text-faint', className)} {...props} />;
}
