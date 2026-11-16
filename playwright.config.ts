import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets parallel agent worktrees each run their own preview server (default 4173).
const port = Number(process.env.E2E_PORT) || 4173;
const desktop = { viewport: { width: 1280, height: 800 } };
const phone = { viewport: { width: 375, height: 812 }, hasTouch: true };

// Firefox is opt-in (E2E_FIREFOX=1 or CI): Playwright's Firefox build fails to launch on the dev Windows 10 machine (mozglue side-by-side error).
const includeFirefox = !!process.env.CI || process.env.E2E_FIREFOX === '1';
const firefoxProjects = [
  { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], ...desktop } },
  // Firefox has no mobile emulation (isMobile); phone size + touch only.
  { name: 'firefox-phone', use: { ...devices['Desktop Firefox'], ...phone } },
];

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
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...desktop } },
    { name: 'chromium-phone', use: { ...devices['Desktop Chrome'], ...phone, isMobile: true } },
    ...(includeFirefox ? firefoxProjects : []),
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], ...desktop } },
    { name: 'webkit-phone', use: { ...devices['Desktop Safari'], ...phone, isMobile: true } },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/snap-convert/`,
    // Never reuse a server we didn't start when a custom port is set: it could be another worktree's build.
    reuseExistingServer: !process.env.CI && !process.env.E2E_PORT,
    timeout: 180_000,
  },
});
