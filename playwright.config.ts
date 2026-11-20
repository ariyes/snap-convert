import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets parallel agent worktrees each run their own preview server (default 4173).
const port = Number(process.env.E2E_PORT) || 4173;
const desktop = { viewport: { width: 1280, height: 800 } };
const phone = { viewport: { width: 375, height: 812 }, hasTouch: true };

// Firefox is opt-in (E2E_FIREFOX=1 or CI): Playwright's Firefox build fails to launch on the dev Windows 10 machine (mozglue side-by-side error).
const includeFirefox = !!process.env.CI || process.env.E2E_FIREFOX === '1';
// Playwright only sees downloads that Firefox saves without offering to show them itself. Firefox
// offers that for WebP, AVIF, SVG, XML and JXL (users still get the file), so turn it off here.
const firefox = {
  ...devices['Desktop Firefox'],
  launchOptions: { firefoxUserPrefs: { 'browser.download.viewableInternally.enabledTypes': '' } },
};
const firefoxProjects = [
  { name: 'firefox-desktop', use: { ...firefox, ...desktop } },
  // Firefox has no mobile emulation (isMobile); phone size + touch only.
  { name: 'firefox-phone', use: { ...firefox, ...phone } },
];

const browserProjects = [
  { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...desktop } },
  { name: 'chromium-phone', use: { ...devices['Desktop Chrome'], ...phone, isMobile: true } },
  ...(includeFirefox ? firefoxProjects : []),
  { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], ...desktop } },
  { name: 'webkit-phone', use: { ...devices['Desktop Safari'], ...phone, isMobile: true } },
];

/** Tag for tests too heavy to share the machine with the rest of the suite. */
const HEAVY = /@heavy/;

/**
 * Tests whose page process crashes (signal 11, no error from our code) in Playwright's Firefox
 * build on GitHub's headless Linux runners. The same steps work in real Firefox (owner check,
 * 2026-11-20; D46), so Firefox skips them; Chromium and WebKit still run them.
 */
const FIREFOX_CI_CRASH = /@firefox-ci-crash/;

/** End-to-end tests run against the production build (pre-rendered pages), served by `vite preview`. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}/snap-convert/`,
    trace: 'on-first-retry',
    // No transitions: accessibility scans must not catch a button mid-fade (the UI honours this setting).
    reducedMotion: 'reduce',
  },
  projects: [
    ...browserProjects.map((p) => ({
      ...p,
      grepInvert: p.name.startsWith('firefox') ? [HEAVY, FIREFOX_CI_CRASH] : HEAVY,
    })),
    // Tests tagged @heavy (61 MP RAW develops, the 7 × 4 format matrix) run last, once every
    // other project has finished, so they never fight the rest of the suite for CPU and memory.
    // To run only them in one browser: --project=webkit-desktop-heavy.
    ...browserProjects.map((p) => ({
      ...p,
      name: `${p.name}-heavy`,
      grep: HEAVY,
      dependencies: browserProjects.map((b) => b.name),
    })),
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/snap-convert/`,
    // Never reuse a server we didn't start when a custom port is set: it could be another worktree's build.
    reuseExistingServer: !process.env.CI && !process.env.E2E_PORT,
    timeout: 180_000,
  },
});
