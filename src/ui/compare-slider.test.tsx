import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompareSlider } from './compare-slider';

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof CompareSlider>[0]> = {}) {
  const onSplitChange = vi.fn();
  render(
    <CompareSlider
      before={<img src="data:," alt="" />}
      after={<img src="data:," alt="" />}
      onSplitChange={onSplitChange}
      {...props}
    />,
  );
  const slider = screen.getByRole('slider', { name: 'Compare original and compressed' });
  const now = () => Number(slider.getAttribute('aria-valuenow'));
  return { slider, now, onSplitChange };
}

describe('CompareSlider', () => {
  it('starts in the middle and is keyboard focusable', async () => {
    const user = userEvent.setup();
    const { slider, now } = setup();
    expect(now()).toBe(50);
    await user.tab();
    expect(document.activeElement).toBe(slider);
  });

  it('moves the split with the arrow keys', async () => {
    const user = userEvent.setup();
    const { now, onSplitChange } = setup();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(now()).toBe(51);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(now()).toBe(49);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(now()).toBe(59);
    expect(onSplitChange).toHaveBeenLastCalledWith(59);
  });

  it('jumps to the edges with Home and End and never goes past them', async () => {
    const user = userEvent.setup();
    const { now } = setup();
    await user.tab();
    await user.keyboard('{End}{ArrowRight}');
    expect(now()).toBe(100);
    await user.keyboard('{Home}{ArrowLeft}');
    expect(now()).toBe(0);
  });

  it('clips the after layer at the split', async () => {
    const user = userEvent.setup();
    const { slider } = setup({ defaultSplit: 30 });
    await user.tab();
    await user.keyboard('{ArrowRight}');
    const after = slider.children[1] as HTMLElement;
    expect(after.style.clipPath).toBe('inset(0 0 0 31%)');
  });

  it('follows the pointer when dragged', () => {
    const { slider, now } = setup();
    slider.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 100 });
    fireEvent.pointerDown(slider, { button: 0, clientX: 50, pointerId: 1 });
    expect(now()).toBe(25);
    fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 });
    expect(now()).toBe(75);
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 10, pointerId: 1 });
    expect(now()).toBe(75);
  });

  it('can be controlled', async () => {
    const user = userEvent.setup();
    const { now, onSplitChange } = setup({ split: 20 });
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(onSplitChange).toHaveBeenCalledWith(21);
    // The parent didn't update `split`, so it stays.
    expect(now()).toBe(20);
  });
});
