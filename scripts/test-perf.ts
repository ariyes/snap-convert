// Runs the browser tests with VITE_PERF=1 so wall-clock limits use the real targets (see tests/support/timing.ts).
// A tiny Node wrapper because `VITE_PERF=1 vitest` doesn't work in pnpm scripts on Windows.
import { spawnSync } from 'node:child_process';

const result = spawnSync('vitest', ['run', '--project', 'browser', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_PERF: '1' },
});
process.exit(result.status ?? 1);
