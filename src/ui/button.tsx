import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap no-underline',
    'border font-medium transition-[background-color,border-color,opacity] duration-150',
    'disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45',
  ],
  {
    variants: {
      variant: {
        default: 'border-line bg-card text-fg hover:border-faint',
        primary: 'border-accent bg-accent text-on-accent hover:opacity-90',
        ghost: 'border-transparent bg-transparent text-muted hover:bg-sunk hover:text-fg',
      },
      size: {
        sm: 'h-8 rounded-lg px-2.5 text-ui',
        md: 'h-10 rounded-control px-4',
        lg: 'h-12 rounded-control px-[22px] text-base',
      },
      iconOnly: { true: 'px-0', false: '' },
      block: { true: 'w-full', false: '' },
    },
    compoundVariants: [
      { iconOnly: true, size: 'sm', className: 'w-8' },
      { iconOnly: true, size: 'md', className: 'w-10' },
      { iconOnly: true, size: 'lg', className: 'w-12' },
    ],
    defaultVariants: { variant: 'default', size: 'md', iconOnly: false, block: false },
  },
);

export interface ButtonProps
  extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a link or a file-input label) with button styles. */
  asChild?: boolean;
}

/**
 * Prototype `.btn`. Variants: default, primary, ghost. Sizes: sm, md, lg.
 * Icon-only buttons need an `aria-label`.
 */
export function Button({
  className,
  variant,
  size,
  iconOnly,
  block,
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, iconOnly, block }), className);
  if (asChild) return <Slot className={classes} {...props} />;
  return <button type={type ?? 'button'} className={classes} {...props} />;
}
