import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clamp, NumberField } from './number-field';

afterEach(cleanup);

function Demo({ onChange, initial = 50 }: { onChange?: (v: number) => void; initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberField
        aria-label="Size"
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        min={1}
        max={100}
        unit="%"
      />
      <button type="button" onClick={() => setValue(50)}>
        Reset
      </button>
      <output>{value}</output>
    </>
  );
}

const field = () => screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Size' });

describe('clamp', () => {
  it('keeps values within min and max', () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-3, 1, 10)).toBe(1);
    expect(clamp(42, 1, 10)).toBe(10);
    expect(clamp(42)).toBe(42);
  });
});

describe('NumberField', () => {
  it('shows the unit and describes the field with it', () => {
    render(<Demo />);
    const unitId = field().getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(unitId)?.textContent).toBe('%');
  });

  it('updates live while the value is in range', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Demo onChange={onChange} />);
    await user.clear(field());
    await user.type(field(), '75');
    expect(onChange).toHaveBeenLastCalledWith(75);
    expect(screen.getByRole('status').textContent).toBe('75');
  });

  it('clamps to max when leaving the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Demo onChange={onChange} />);
    await user.clear(field());
    await user.type(field(), '5000');
    await user.tab();
    expect(field().value).toBe('100');
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('clamps to min on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Demo onChange={onChange} />);
    await user.clear(field());
    await user.type(field(), '0{Enter}');
    expect(field().value).toBe('1');
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('restores the last value when left empty', async () => {
    const user = userEvent.setup();
    render(<Demo initial={40} />);
    await user.clear(field());
    await user.tab();
    expect(field().value).toBe('40');
  });

  it('shows a value changed from outside', async () => {
    const user = userEvent.setup();
    render(<Demo initial={20} />);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(field().value).toBe('50');
  });
});
