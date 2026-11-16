import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('joins class names and skips falsy values', () => {
    expect(cn('p-2', false, undefined, 'text-sm')).toBe('p-2 text-sm');
  });

  it('lets later Tailwind classes win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('knows the theme font sizes are not colours', () => {
    expect(cn('text-on-accent', 'text-ui')).toBe('text-on-accent text-ui');
    expect(cn('text-sm', 'text-body')).toBe('text-body');
  });

  it('merges the theme radius and shadow scales', () => {
    expect(cn('rounded-control', 'rounded-full')).toBe('rounded-full');
    expect(cn('shadow-card', 'shadow-raised')).toBe('shadow-raised');
  });
});
