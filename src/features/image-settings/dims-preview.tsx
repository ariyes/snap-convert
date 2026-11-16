import { Lock, TriangleAlert } from 'lucide-react';
import type { Size } from '@/core/contracts/sizing';
import { cn } from '@/lib/utils';
import { planSize } from './plan';
import { imageSettingsStrings as strings } from './strings';
import type { ResizeValues } from './values';

export interface DimsPreviewProps {
  /** Visible size of the image (orientation applied). Nothing is shown without it. */
  source: Size | null | undefined;
  /** Current resize settings. */
  values: ResizeValues;
  /** The tool has an "Also resize" checkbox (resizeEnabled applies). */
  optional?: boolean;
  /**
   * Smallest longest side that looks sharp for the chosen use (P12 `minRecommendedSide`), e.g. 1200
   * for full-width images. A smaller result shows a warning.
   */
  minRecommendedSide?: number;
  className?: string;
}

/**
 * "4032×3024 → 1920×1440 · Proportions locked". The text comes from describe() in the sizing module
 * and the result from fitSize / exactPlacement (via planSize): no size maths here.
 */
export function DimsPreview({
  source,
  values,
  optional = false,
  minRecommendedSide,
  className,
}: DimsPreviewProps) {
  const plan = source ? planSize(source, values, { optional }) : null;
  if (!plan) return null;

  const [from, to] = plan.text.split(' → ');
  const status = [
    plan.notEnlarged
      ? strings.notEnlarged
      : plan.enlarged
        ? strings.enlarged
        : strings.proportionsLocked,
    plan.padded && strings.padded,
    plan.cropped && strings.cropped,
  ]
    .filter(Boolean)
    .join(' · ');
  const longest = Math.max(plan.output.width, plan.output.height);
  const tooSmall = minRecommendedSide !== undefined && longest < minRecommendedSide;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p
        data-testid="dims-preview"
        className="m-0 flex flex-wrap items-center gap-2 rounded-control bg-accent-soft px-3 py-2.5 font-mono text-ui text-accent"
      >
        <Lock aria-hidden="true" className="size-[15px]" />
        <span className="sr-only">{strings.dimsLabel}: </span>
        {to === undefined ? (
          <strong className="font-semibold">{plan.text}</strong>
        ) : (
          <>
            <span>{from}</span>
            <span className="opacity-60">→</span>
            <strong className="font-semibold">{to}</strong>
          </>
        )}
        <span className="ml-auto font-sans text-xs">
          <span className="sr-only">, </span>
          {status}
        </span>
      </p>
      {tooSmall && (
        <p className="m-0 flex items-start gap-2 rounded-control bg-warn-bg px-3 py-2.5 text-ui text-warn">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4" />
          <span>{strings.smallForUse(minRecommendedSide)}</span>
        </p>
      )}
    </div>
  );
}
