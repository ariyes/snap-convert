import { useId, type ComponentProps } from 'react';

export interface LogoProps extends Omit<ComponentProps<'svg'>, 'children'> {
  /** Width and height in px. Default 32. */
  size?: number;
  /** Accessible name. Leave empty when text next to the logo already says "Snap Convert". */
  title?: string;
}

/** Brand C mark (decision D15): a lightning bolt in a rounded accent square. Follows the theme. */
export function Logo({ size = 32, title, ...props }: LogoProps) {
  const titleId = useId();
  const a11y = title
    ? { role: 'img', 'aria-labelledby': titleId }
    : { 'aria-hidden': true as const, focusable: false as const };
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" {...a11y} {...props}>
      {title && <title id={titleId}>{title}</title>}
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-accent" />
      <g transform="translate(5 5) scale(.917)">
        <path
          d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
          className="fill-on-accent"
        />
      </g>
    </svg>
  );
}
