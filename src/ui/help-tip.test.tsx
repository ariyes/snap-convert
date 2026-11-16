import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpTip } from './help-tip';

afterEach(cleanup);

const TEXT = 'Lower quality makes a smaller file.';

describe('HelpTip', () => {
  it('is a named button described by the tip text, hidden until opened', () => {
    render(<HelpTip label="About quality">{TEXT}</HelpTip>);
    const button = screen.getByRole('button', { name: 'About quality' });
    expect(button).toHaveProperty('type', 'button');
    // Screen readers get the text as the button's description.
    const tip = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(tip?.textContent).toBe(TEXT);
    expect(tip?.getAttribute('role')).toBe('tooltip');
    expect(tip?.hidden).toBe(true);
  });

  it('opens on keyboard focus and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<HelpTip>{TEXT}</HelpTip>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'More info' })).toBe(document.activeElement);
    expect(screen.getByRole('tooltip').hidden).toBe(false);

    await user.keyboard('{Escape}');
    expect(screen.getByRole('tooltip', { hidden: true }).hidden).toBe(true);
    // Focus stays on the button.
    expect(screen.getByRole('button', { name: 'More info' })).toBe(document.activeElement);
  });

  it('closes when focus leaves', async () => {
    const user = userEvent.setup();
    render(
      <>
        <HelpTip>{TEXT}</HelpTip>
        <button type="button">Next</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole('tooltip').hidden).toBe(false);
    await user.tab();
    expect(screen.getByRole('tooltip', { hidden: true }).hidden).toBe(true);
  });

  it('opens on tap/click', () => {
    render(<HelpTip>{TEXT}</HelpTip>);
    fireEvent.click(screen.getByRole('button', { name: 'More info' }));
    expect(screen.getByRole('tooltip').hidden).toBe(false);
  });

  it('closes on a tap elsewhere', () => {
    render(<HelpTip>{TEXT}</HelpTip>);
    fireEvent.click(screen.getByRole('button', { name: 'More info' }));
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('tooltip', { hidden: true }).hidden).toBe(true);
  });

  it('opens on mouse hover and closes when the mouse leaves', () => {
    render(<HelpTip>{TEXT}</HelpTip>);
    const button = screen.getByRole('button', { name: 'More info' });
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip').hidden).toBe(false);
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip', { hidden: true }).hidden).toBe(true);
  });
});
