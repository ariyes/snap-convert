import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label'> {
  /** Accessible name (the button shows only an icon). */
  label: string;
  /** md = 36 px (header), sm = 28 px (tile actions). */
  size?: 'sm' | 'md';
  /** Render the child element (e.g. a link) with icon-button styles. */
  asChild?: boolean;
}

/** Prototype `.icon-btn`: round, quiet, icon only. */
export function IconButton({
  label,
  size = 'md',
  asChild = false,
  className,
  type,
  ...props
}: IconButtonProps) {
  const classes = cn(
    'inline-grid shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted no-underline',
    'hover:bg-sunk hover:text-fg disabled:cursor-not-allowed disabled:opacity-45',
    size === 'md' ? 'size-9' : 'size-7 [&_svg]:size-[15px]',
    className,
  );
  if (asChild) return <Slot aria-label={label} className={classes} {...props} />;
  return <button type={type ?? 'button'} aria-label={label} className={classes} {...props} />;
}
