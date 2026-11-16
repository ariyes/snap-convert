import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageSettingsStrings } from '@/features/image-settings';
import { clearSettingsMemory } from '@/features/settings/storage';
import { strings as uiStrings } from '@/ui';
import ToolLayoutDemo from './demo';
import { ResponsiveLabel } from './responsive-label';
import { toolLayoutStrings as strings } from './strings';
import { ToolEmptyState, ToolPage } from './tool-page';
import { Workspace } from './workspace';

const META = {
  name: 'Compress image',
  group: 'Images',
  short: 'Smaller files, same look.',
} as const;
const inRouter = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  clearSettingsMemory();
});
afterEach(cleanup);

describe('ToolPage', () => {
  it('shows breadcrumb, title, description and the privacy line', () => {
    inRouter(<ToolPage meta={META} />);
    const crumbs = screen.getByRole('navigation', { name: strings.breadcrumb });
    expect(within(crumbs).getByRole('link', { name: strings.allTools }).getAttribute('href')).toBe(
      '/',
    );
    expect(within(crumbs).getByText('Images')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Compress image' })).toBeTruthy();
    expect(screen.getByText('Smaller files, same look.')).toBeTruthy();
    expect(screen.getByText(strings.privacyLine)).toBeTruthy();
  });

  it('shows the empty state until there are files, then the workspace', () => {
    const { rerender } = inRouter(
      <ToolPage meta={META} empty={<p>drop here</p>} workspace={<p>workspace</p>}>
        <p>after</p>
      </ToolPage>,
    );
    expect(screen.getByText('drop here')).toBeTruthy();
    expect(screen.queryByText('workspace')).toBeNull();
    expect(screen.getByText('after')).toBeTruthy();
    rerender(
      <MemoryRouter>
        <ToolPage meta={META} hasFiles empty={<p>drop here</p>} workspace={<p>workspace</p>} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('drop here')).toBeNull();
    expect(screen.getByText('workspace')).toBeTruthy();
  });
});

describe('ToolEmptyState', () => {
  it('has a "Try with a sample" button that is disabled while busy', async () => {
    const onSample = vi.fn();
    const { rerender } = render(
      <ToolEmptyState
        dropZone={<div>zone</div>}
        sampleLabel="Try with a sample photo"
        onSample={onSample}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try with a sample photo' }));
    expect(onSample).toHaveBeenCalledOnce();
    rerender(<ToolEmptyState dropZone={<div>zone</div>} onSample={onSample} sampleBusy />);
    const busy = screen.getByRole<HTMLButtonElement>('button', { name: strings.makingSample });
    expect(busy.disabled).toBe(true);
  });
});

describe('Workspace', () => {
  it('has the files, a labelled settings panel with Reset, and one set of actions', async () => {
    const onReset = vi.fn();
    render(
      <Workspace
        main={<p>files</p>}
        panelTitle="Settings for all files"
        onReset={onReset}
        announceReset={false}
        panel={<p>controls</p>}
        actions={<button type="button">Download</button>}
      />,
    );
    const panel = screen.getByRole('complementary', { name: strings.settingsLabel });
    expect(within(panel).getByRole('heading', { name: 'Settings for all files' })).toBeTruthy();
    expect(within(panel).getByText('controls')).toBeTruthy();
    const actions = within(panel).getByRole('group', { name: strings.actionsLabel });
    expect(within(actions).getAllByRole('button', { name: 'Download' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
    // Space is kept for the phone action bar.
    expect(screen.getByTestId('action-bar-spacer')).toBeTruthy();

    await userEvent.click(within(panel).getByRole('button', { name: uiStrings.reset }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('has no Reset button or action bar when not asked for', () => {
    render(<Workspace main={null} panelTitle="Settings" panel={null} />);
    expect(screen.queryByRole('button', { name: uiStrings.reset })).toBeNull();
    expect(screen.queryByTestId('action-bar-spacer')).toBeNull();
  });
});

describe('ResponsiveLabel', () => {
  it('renders the wide and narrow text for CSS to pick', () => {
    render(<ResponsiveLabel wide="Download all 3 as ZIP" narrow="All (ZIP)" />);
    expect(screen.getByText('Download all 3 as ZIP').className).toContain('max-[880px]:hidden');
    expect(screen.getByText('All (ZIP)').className).toContain('min-[880px]:hidden');
  });
});

describe('demo page', () => {
  const s = imageSettingsStrings;

  it('remembers settings across a reload; Reset restores defaults and clears the preset', async () => {
    const user = userEvent.setup();
    inRouter(<ToolLayoutDemo />);
    const panel = () => screen.getByRole('complementary', { name: strings.settingsLabel });

    await user.click(within(panel()).getByRole('button', { name: 'Email' }));
    expect(
      within(panel()).getByRole('button', { name: 'Email' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByTestId('dims-preview').textContent).toContain('800×600');

    // Reload: settings come back from storage.
    cleanup();
    clearSettingsMemory();
    inRouter(<ToolLayoutDemo />);
    expect(
      within(panel()).getByRole('button', { name: 'Email' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(panel()).getByRole('checkbox', { name: s.alsoResize }).getAttribute('aria-checked'),
    ).toBe('true');

    await user.click(within(panel()).getByRole('button', { name: uiStrings.reset }));
    expect(
      within(panel()).getByRole('button', { name: 'Email' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      within(panel()).getByRole('checkbox', { name: s.alsoResize }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByRole('slider', { name: s.quality }).getAttribute('aria-valuenow')).toBe(
      '80',
    );
  });

  it('shows the Bulk panel and the empty state', async () => {
    const user = userEvent.setup();
    inRouter(<ToolLayoutDemo />);
    await user.click(screen.getByRole('radio', { name: 'Bulk' }));
    expect(screen.getByRole('heading', { name: 'Settings for all files' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: s.fileNames })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resize 6 images/ })).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: 'Empty' }));
    expect(screen.getByRole('button', { name: 'Try with a sample photo' })).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('labels every control', async () => {
    const user = userEvent.setup();
    inRouter(<ToolLayoutDemo />);
    for (const view of ['Compress', 'Bulk']) {
      await user.click(screen.getByRole('radio', { name: view }));
      const panel = screen.getByRole('complementary', { name: strings.settingsLabel });
      const roles = ['button', 'checkbox', 'radio', 'slider', 'spinbutton', 'textbox', 'combobox'];
      const controls = roles.flatMap((role) => within(panel).queryAllByRole(role));
      expect(controls.length).toBeGreaterThan(8);
      for (const control of controls) {
        const name =
          control.getAttribute('aria-label') ??
          control.getAttribute('aria-labelledby') ??
          (control.id ? document.querySelector(`label[for="${control.id}"]`)?.textContent : null) ??
          control.textContent;
        expect(name?.trim(), control.outerHTML).toBeTruthy();
      }
    }
  });
});
