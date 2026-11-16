import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Prototype `kbd`: a key name, e.g. <Kbd>Ctrl</Kbd> + <Kbd>V</Kbd>. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'rounded border border-line bg-sunk px-[5px] py-px font-mono text-2xs text-muted',
        className,
      )}
      {...props}
    />
  );
}
