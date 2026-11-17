import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_CAPTURE_SCRIPT, INSTALL_PROMPT_KEY } from './install';
import { InstallAppButton } from './install-button';

/** Runs the inline script the page ships in <body> (happy-dom doesn't run <script> tags). */
function runCaptureScript(): void {
  // Indirect eval: global scope, like a classic inline script.
  (0, eval)(INSTALL_CAPTURE_SCRIPT);
}

function fakePromptEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  });
  return { event, prompt };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY];
});

describe('Install app button', () => {
  runCaptureScript();

  it('is hidden until the browser offers installation (and on Safari, which never does)', () => {
    render(<InstallAppButton />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('appears on beforeinstallprompt, hides the browser bar, and opens the install dialog', async () => {
    render(<InstallAppButton />);
    const { event, prompt } = fakePromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    const button = screen.getByRole('button', { name: 'Install app' });

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    // The event can only be used once.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows even when the event fired before the app hydrated', () => {
    const { event } = fakePromptEvent();
    window.dispatchEvent(event);
    render(<InstallAppButton />);
    expect(screen.getByRole('button', { name: 'Install app' })).toBeTruthy();
  });

  it('goes away once the app is installed', () => {
    render(<InstallAppButton />);
    act(() => {
      window.dispatchEvent(fakePromptEvent().event);
    });
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
