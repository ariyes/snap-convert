import { RotateCcw } from 'lucide-react';
import { Button, type ButtonProps } from './button';
import { strings } from './strings';

/** APP-12: the "Reset" button at the top of every settings panel (prototype `#cmp-reset`). */
export function ResetButton({ children, title, ...props }: Omit<ButtonProps, 'variant' | 'size'>) {
  return (
    <Button variant="ghost" size="sm" title={title ?? strings.resetTitle} {...props}>
      <RotateCcw aria-hidden="true" />
      {children ?? strings.reset}
    </Button>
  );
}
