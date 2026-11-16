import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends ComponentProps<'div'> {
  /** Adds the soft drop shadow (prototype `.suggest`). */
  elevated?: boolean;
}

/** Prototype `.card`: bordered surface with the 12 px radius. */
export function Card({ elevated = false, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-card text-fg',
        elevated && 'shadow-card',
        className,
      )}
      {...props}
    />
  );
}
