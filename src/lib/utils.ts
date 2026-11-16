import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge told about the custom theme scales in src/ui/theme.css, so e.g. `text-ui`
 * (a font size) doesn't cancel `text-on-accent` (a colour).
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['2xs', 'ui', 'body'],
      radius: ['card', 'control'],
      shadow: ['card', 'raised', 'handle', 'handle-line'],
    },
  },
});

/** Joins class names and lets later Tailwind classes override earlier ones (shadcn/ui helper). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
