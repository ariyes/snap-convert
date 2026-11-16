// Runs `playwright test` with E2E_FIREFOX=1 so the opt-in Firefox projects are included.
// A tiny Node wrapper instead of `E2E_FIREFOX=1 playwright test`, which doesn't work in pnpm scripts on Windows.
import { spawnSync } from 'node:child_process';

const result = spawnSync('playwright', ['test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_FIREFOX: '1' },
});
process.exit(result.status ?? 1);
