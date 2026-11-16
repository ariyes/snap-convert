import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpTip } from './help-tip';

afterEach(cleanup);

// Real browser: label activation rules differ in happy-dom.
describe('HelpTip in a real browser', () => {
  it('opens on click without toggling the control of a surrounding <label>', () => {
    render(
      <label>
        <input type="checkbox" /> Remove location
        <HelpTip>Photos can contain hidden details.</HelpTip>
      </label>,
    );
    act(() => screen.getByRole('button', { name: 'More info' }).click());
    expect(screen.getByRole('tooltip').hidden).toBe(false);
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
  });
});
