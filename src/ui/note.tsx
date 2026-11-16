import { Info, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export interface NoteProps extends ComponentProps<'div'> {
  /** Icon shown before the text (default: Info). */
  icon?: LucideIcon;
}

/** Prototype `.note`: a quiet information line with an accent icon. */
export function Note({ icon: Icon = Info, className, children, ...props }: NoteProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-control bg-sunk px-3 py-2.5 text-ui text-muted',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 text-accent" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
