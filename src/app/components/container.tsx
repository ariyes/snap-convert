import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Prototype `.container`: 1120 px wide, 16 px side padding (24 px from 640 px). */
export function Container({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mx-auto w-full max-w-[1120px] px-4 sm:px-6', className)} {...props} />;
}
