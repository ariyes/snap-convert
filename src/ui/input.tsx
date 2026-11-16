import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Prototype `.input`: shared by Input, NumberField and Select. */
export const inputClass = cn(
  'h-[38px] w-full min-w-0 rounded-lg border border-line bg-card px-2.5 text-fg',
  'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent',
  'disabled:cursor-not-allowed disabled:opacity-45',
);

/** Plain text input with the prototype look (e.g. the file-name pattern). */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input type={type} className={cn(inputClass, className)} {...props} />;
}
