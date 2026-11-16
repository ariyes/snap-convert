import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormatSelect } from './format-select';
import { ResizeFields } from './resize-fields';
import { imageSettingsStrings as strings } from './strings';
import { IMAGE_SETTINGS_DEFAULTS, type ImageSettingsValues } from './values';

afterEach(cleanup);

function Panel() {
  const [v, setV] = useState<ImageSettingsValues>({ ...IMAGE_SETTINGS_DEFAULTS });
  const update = (patch: Partial<ImageSettingsValues>) => setV((prev) => ({ ...prev, ...patch }));
  return (
    <>
      <FormatSelect value={v} onChange={update} />
      <ResizeFields value={v} onChange={update} />
      <output>{JSON.stringify(v)}</output>
    </>
  );
}
const values = () =>
  JSON.parse(screen.getByRole('status').textContent ?? '{}') as ImageSettingsValues;

// Real browser: Radix Select and focus handling need real layout and pointer/keyboard events.
describe('image settings with the keyboard', () => {
  it('picks a format and a resize mode, and opens help tips on focus', async () => {
    const user = userEvent.setup();
    render(<Panel />);

    const format = screen.getByRole('combobox', { name: strings.saveAs });
    act(() => format.focus());
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'WebP' }));
    expect(values().format).toBe('webp');

    // Tab from the format to the resize mode's help tip, which opens on focus.
    act(() => format.focus());
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: strings.resizeByTipLabel }),
    );
    expect(screen.getByRole('tooltip').hidden).toBe(false);

    await user.tab();
    const mode = screen.getByRole('combobox', { name: strings.resizeBy });
    expect(document.activeElement).toBe(mode);
    await user.keyboard('{Enter}');
    const exact = await screen.findByRole('option', { name: strings.resizeModes.exact });
    await user.click(exact);
    expect(values().resizeMode).toBe('exact');
    expect(screen.getByRole('radiogroup', { name: strings.fitGroup })).toBeTruthy();

    // Fit / Fill cards move with the arrow keys.
    const fitCard = screen.getByRole('radio', { name: strings.fit });
    await user.click(fitCard);
    // Held like a real key press: Radix moves focus a tick after keydown and checks while the key is down.
    await user.keyboard('{ArrowRight>}');
    await vi.waitFor(() => expect(values().fit).toBe('fill'));
    await user.keyboard('{/ArrowRight}');
  });
});
