import { cn } from '@/lib/utils';
import { strings } from './strings';

export interface ProgressBarProps {
  /** 0–1 (same as Job.progress). */
  value: number;
  /** Accessible name, e.g. the file name. Default "Progress". */
  label?: string;
  /** sm = 72 × 6 px (file rows), lg = full width × 8 px. */
  size?: 'sm' | 'lg';
  className?: string;
}

/** Prototype `.bar`: a thin accent progress bar. */
export function ProgressBar({
  value,
  label = strings.progress,
  size = 'sm',
  className,
}: ProgressBarProps) {
  const fraction = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(fraction * 100);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn(
        'block overflow-hidden rounded-full bg-sunk',
        size === 'sm' ? 'h-1.5 w-[72px]' : 'h-2 w-full',
        className,
      )}
    >
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-100 ease-linear"
        style={{ width: `${fraction * 100}%` }}
      />
    </span>
  );
}
