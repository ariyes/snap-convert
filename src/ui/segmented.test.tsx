import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented } from './segmented';

afterEach(cleanup);

type Mode = 'quality' | 'target' | 'lossless';
const OPTIONS = [
  { value: 'quality', label: 'By quality' },
  { value: 'target', label: 'Target file size' },
  { value: 'lossless', label: 'Lossless' },
] as const;

function Demo({ onChange }: { onChange?: (v: Mode) => void }) {
  const [value, setValue] = useState<Mode>('quality');
  return (
    <Segmented
      label="Compression mode"
      options={OPTIONS}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const checked = (name: string) =>
  screen.getByRole('radio', { name }).getAttribute('aria-checked') === 'true';

describe('Segmented', () => {
  it('is a named group with one option selected', () => {
    render(<Demo />);
    expect(screen.getByRole('radiogroup', { name: 'Compression mode' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(checked('By quality')).toBe(true);
    expect(checked('Target file size')).toBe(false);
  });

  it('selects on click and reports the typed value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Demo onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Target file size' }));
    expect(onChange).toHaveBeenCalledWith('target');
    expect(checked('Target file size')).toBe(true);
    expect(checked('By quality')).toBe(false);
  });

  it('moves the selection with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'By quality' }));
    // Radix moves focus on the next tick, while the key is still down (as with a real key press).
    const press = async (key: string) => {
      await user.keyboard(`{${key}>}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await user.keyboard(`{/${key}}`);
    };
    await press('ArrowRight');
    expect(checked('Target file size')).toBe(true);
    await press('ArrowRight');
    expect(checked('Lossless')).toBe(true);
    await press('ArrowLeft');
    expect(checked('Target file size')).toBe(true);
  });

  it('cannot be left with nothing selected', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole('radio', { name: 'By quality' }));
    expect(checked('By quality')).toBe(true);
  });
});
