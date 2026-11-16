import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Prototype `.panel hr`: a thin line between groups of settings. */
export function PanelDivider({ className }: { className?: string }) {
  return <hr className={cn('m-0 w-full border-0 border-t border-line', className)} />;
}

/** Prototype `.section`: a group of related settings, 10 px apart. */
export function PanelSection({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-2.5', className)} {...props} />;
}

/** Prototype `.field`: a label line and its control, 6 px apart. */
export function Field({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex min-w-0 flex-col gap-1.5', className)} {...props} />;
}
