// Deploys Snap Convert to the owner's server (P25). Run through deploy/deploy.ps1 (Windows) or
// deploy/deploy.sh; both call this file.
//
//   node deploy/deploy.ts               build, check, upload, switch, print the rollback command
//   node deploy/deploy.ts --dry-run     everything up to the upload; prints the commands instead
//   node deploy/deploy.ts --local DIR   deploy into a local folder (tests the release switch)
//   node deploy/deploy.ts --skip-build  reuse build/client
//
// Settings come from deploy/.env (git-ignored; copy deploy/.env.example). It holds the host, user
// and folder only — never passwords or keys. Use an SSH key (ssh-agent on Windows) for login.
//
// What happens:
//   1. pnpm build, then deploy/check-build.ts (paths under /snap-convert/, sizes)
//   2. stage build/deploy/<release>/ :
//        snap-convert/   build/client + .gz/.br copies of text and wasm files (gzip_static)
//        deploy/         CSP template + this build's script hashes (deploy/csp.ts), activate.sh
//   3. pack it as one .tgz, copy it to DEPLOY_PATH with scp
//   4. over ssh: unpack into DEPLOY_PATH/releases/<release>/ and run activate.sh, which switches
//      the `current` symlink, rewrites security-headers.conf, reloads nginx and keeps 3 releases
//   5. print the rollback command and the smoke-test command
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { checkBuild, formatBytes, listFiles, sizeReport } from './check-build.ts';
import { readEnvFile, REPO_ROOT, templateOptionsFromEnv, writeHeaders } from './csp.ts';
import { BASE_PATH, LIVE_URL } from './headers.ts';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

export const DEFAULT_RELOAD = 'sudo -n nginx -t && sudo -n systemctl reload nginx';

export interface DeployConfig {
  host: string;
  user: string;
  port: string;
  path: string;
  keep: number;
  reload: string;
  sshKey: string;
}

/** Shell-quotes one word for the remote POSIX shell. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function readConfig(env: Record<string, string | undefined>): DeployConfig {
  const host = env.DEPLOY_HOST?.trim() ?? '';
  const appPath = (env.DEPLOY_PATH?.trim() ?? '').replace(/\/+$/, '');
  const keep = Number(env.DEPLOY_KEEP?.trim() || '3');
  const reload = env.DEPLOY_RELOAD?.trim() || DEFAULT_RELOAD;
  const problems: string[] = [];
  if (!host) problems.push('DEPLOY_HOST is empty');
  if (!/^[A-Za-z0-9.-]*$/.test(host)) {
    problems.push('DEPLOY_HOST: letters, digits, "." and "-" only');
  }
  if (!/^\/[A-Za-z0-9._/-]+$/.test(appPath) || appPath.split('/').includes('..')) {
    problems.push('DEPLOY_PATH must be an absolute path like /var/www/snap-convert');
  }
  if (!/^[A-Za-z0-9._-]*$/.test(env.DEPLOY_USER?.trim() ?? '')) {
    problems.push('DEPLOY_USER looks wrong');
  }
  if (!/^\d*$/.test(env.DEPLOY_PORT?.trim() ?? '')) problems.push('DEPLOY_PORT must be a number');
  if (!Number.isInteger(keep) || keep < 2) problems.push('DEPLOY_KEEP must be 2 or more');
  // Printed inside double quotes for PowerShell; these would break or expand there.
  if (/["$`\\]/.test(reload)) problems.push('DEPLOY_RELOAD must not contain " $ ` or \\');
  if (problems.length > 0) {
    throw new Error(`deploy/.env is not complete:\n  - ${problems.join('\n  - ')}`);
  }
  return {
    host,
    user: env.DEPLOY_USER?.trim() ?? '',
    port: env.DEPLOY_PORT?.trim() || '22',
    path: appPath,
    keep,
    reload,
    sshKey: env.DEPLOY_SSH_KEY?.trim() ?? '',
  };
}

/** UTC timestamp first, so release folders sort by age; then the commit. */
export function releaseName(now: Date, commit: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return commit ? `${stamp}-${commit}` : stamp;
}

/** activate.sh for a release that is already on the server (also the rollback). */
export function switchCommand(cfg: DeployConfig, release: string): string {
  const script = `${cfg.path}/releases/${release}/deploy/activate.sh`;
  return `sh ${shq(script)} ${shq(cfg.path)} ${shq(release)} ${cfg.keep} ${shq(cfg.reload)}`;
}

/** The command run on the server after the upload: unpack, then switch. */
export function activateCommand(cfg: DeployConfig, release: string): string {
  const rel = `${cfg.path}/releases/${release}`;
  const upload = `${cfg.path}/.upload-${release}.tgz`;
  return [
    'set -e',
    `mkdir -p ${shq(`${cfg.path}/releases`)}`,
    `mkdir ${shq(rel)}`,
    `tar -xzf ${shq(upload)} --no-same-owner --no-same-permissions -C ${shq(rel)}`,
    `rm -f ${shq(upload)}`,
    switchCommand(cfg, release),
  ].join('; ');
}

export function sshArgs(cfg: DeployConfig): string[] {
  return [
    ...(cfg.port !== '22' ? ['-p', cfg.port] : []),
    ...(cfg.sshKey ? ['-i', cfg.sshKey] : []),
    cfg.user ? `${cfg.user}@${cfg.host}` : cfg.host,
  ];
}

export function scpArgs(cfg: DeployConfig, file: string, release: string): string[] {
  const dest = `${cfg.user ? `${cfg.user}@` : ''}${cfg.host}:${cfg.path}/.upload-${release}.tgz`;
  return [
    ...(cfg.port !== '22' ? ['-P', cfg.port] : []),
    ...(cfg.sshKey ? ['-i', cfg.sshKey] : []),
    file,
    dest,
  ];
}

/** A command line the owner can paste into PowerShell or a terminal. */
export function printable(cmd: string, args: string[]): string {
  return [cmd, ...args.map((a) => (/^[A-Za-z0-9@%+=:,./_-]+$/.test(a) ? a : `"${a}"`))].join(' ');
}

/** Files nginx serves compressed (gzip_static / brotli_static). */
const COMPRESSIBLE = /\.(?:html|js|mjs|css|json|webmanifest|svg|xml|txt|wasm|data|ttf|pfb)$/;

/** Writes .gz and .br next to every text and wasm file where it saves at least 10%. */
export async function precompress(dir: string): Promise<{ files: number; saved: number }> {
  let files = 0;
  let saved = 0;
  const targets = listFiles(dir).filter((f) => COMPRESSIBLE.test(f.rel) && f.bytes >= 1024);
  const work = async (rel: string, bytes: number) => {
    const file = path.join(dir, rel);
    const data = readFileSync(file);
    const [gz, br] = await Promise.all([
      gzipAsync(data, { level: 9 }),
      brotliAsync(data, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes,
        },
      }),
    ]);
    if (gz.length < bytes * 0.9) {
      writeFileSync(`${file}.gz`, gz);
      files += 1;
    }
    if (br.length < bytes * 0.9) {
      writeFileSync(`${file}.br`, br);
      saved += bytes - br.length;
    }
  };
  // A few at a time: zlib runs on the thread pool.
  for (let i = 0; i < targets.length; i += 8) {
    await Promise.all(targets.slice(i, i + 8).map((f) => work(f.rel, f.bytes)));
  }
  return { files, saved };
}

function run(cmd: string, args: string[], options: SpawnSyncOptions = {}): void {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`${cmd} could not start: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${printable(cmd, args)} failed (exit ${result.status})`);
}

function output(cmd: string, args: string[], cwd = REPO_ROOT): string {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

/** POSIX sh used for --local: Git for Windows' sh on Windows. */
export function localShell(): { sh: string; env: NodeJS.ProcessEnv } {
  if (process.platform !== 'win32') return { sh: 'sh', env: process.env };
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ]
    .filter((p): p is string => !!p)
    .flatMap((p) => [path.join(p, 'Git'), path.join(p, 'Programs', 'Git')]);
  const git = roots.find((r) => existsSync(path.join(r, 'usr', 'bin', 'sh.exe')));
  if (!git) throw new Error('--local on Windows needs Git for Windows (its sh, tar and ln)');
  const bin = path.join(git, 'usr', 'bin');
  return {
    sh: path.join(bin, 'sh.exe'),
    // Real symlinks need admin rights on Windows; MSYS "sys" links behave the same for sh tools.
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      MSYS: 'winsymlinks:sys',
    },
  };
}

/** C:\a\b → /c/a/b for Git's sh. */
export function posixPath(p: string, platform = process.platform): string {
  if (platform !== 'win32') return path.resolve(p);
  return path.win32
    .resolve(p)
    .replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`)
    .replace(/\\/g, '/');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
      local: { type: 'string' },
    },
  });
  const say = (line = '') => process.stdout.write(`${line}\n`);
  const env = { ...readEnvFile(path.join(REPO_ROOT, 'deploy/.env')), ...process.env };
  const local = values.local ? path.resolve(values.local) : '';
  const cfg = local
    ? readConfig({
        DEPLOY_HOST: 'localhost',
        DEPLOY_PATH: posixPath(local),
        DEPLOY_KEEP: env.DEPLOY_KEEP,
        DEPLOY_RELOAD: 'echo local target: skipped nginx -t and reload',
      })
    : readConfig(env);

  const commit = output('git', ['rev-parse', '--short', 'HEAD']);
  if (output('git', ['status', '--porcelain'])) {
    say('Note: the working tree has uncommitted changes; they are deployed too.');
  }
  const release = releaseName(new Date(), commit);
  say(`Release ${release} → ${local || `${cfg.host}:${cfg.path}`}`);

  // 1. Build and check.
  const buildDir = path.join(REPO_ROOT, 'build/client');
  if (!values['skip-build']) {
    // pnpm is a .cmd on Windows, which only starts through a shell (one fixed command string).
    const built = spawnSync('pnpm build', { cwd: REPO_ROOT, stdio: 'inherit', shell: true });
    if (built.status !== 0) throw new Error('pnpm build failed');
  }
  if (!existsSync(path.join(buildDir, 'index.html'))) throw new Error('No build in build/client');
  const report = checkBuild(buildDir);
  say(sizeReport(report));
  if (report.problems.length > 0) {
    throw new Error(`Build check failed:\n  - ${report.problems.join('\n  - ')}`);
  }
  say(`Build check passed: every path is under ${BASE_PATH}`);

  // 2. Stage.
  const stageRoot = path.join(REPO_ROOT, 'build/deploy');
  const stage = path.join(stageRoot, release);
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(buildDir, path.join(stage, 'snap-convert'), { recursive: true });
  const options = templateOptionsFromEnv(REPO_ROOT);
  const headers = writeHeaders(buildDir, path.join(stage, 'deploy'), options);
  // Unix line endings, whatever git did on checkout.
  const activate = readFileSync(path.join(REPO_ROOT, 'deploy/remote/activate.sh'), 'utf8');
  writeFileSync(path.join(stage, 'deploy/activate.sh'), activate.replace(/\r\n/g, '\n'));
  const info = { release, commit, built: new Date().toISOString(), csp: options };
  writeFileSync(path.join(stage, 'deploy/release.json'), `${JSON.stringify(info, null, 2)}\n`);
  say(
    `CSP: ${headers.hashes.length} inline-script hashes${options.reportOnly ? ' (Report-Only)' : ''}`,
  );
  const packed = await precompress(path.join(stage, 'snap-convert'));
  say(`Precompressed ${packed.files} files (.gz + .br; brotli saves ${formatBytes(packed.saved)})`);

  // 3. Pack. Relative paths only: GNU tar reads "C:..." as a remote host.
  const tgzName = `${release}.tgz`;
  run('tar', ['-czf', `../${tgzName}`, '.'], { cwd: stage });
  const tgz = path.join(stageRoot, tgzName);
  say(`Packed ${tgzName} (${formatBytes(statSync(tgz).size)})`);

  const activateCmd = activateCommand(cfg, release);
  const ssh = sshArgs(cfg);
  if (values['dry-run']) {
    say(`\nDry run — would now run, in ${stageRoot}:`);
    say(`  ${printable('scp', scpArgs(cfg, tgzName, release))}`);
    say(`  ${printable('ssh', [...ssh, activateCmd])}`);
    return;
  }

  // 4. Upload and switch.
  let log: string;
  if (local) {
    mkdirSync(local, { recursive: true });
    copyFileSync(tgz, path.join(local, `.upload-${release}.tgz`));
    const shell = localShell();
    const result = spawnSync(shell.sh, ['-c', activateCmd], { env: shell.env, encoding: 'utf8' });
    log = `${result.stdout}${result.stderr}`;
    process.stdout.write(log);
    if (result.status !== 0) throw new Error('activate.sh failed (see above)');
  } else {
    // Relative file name: an scp from Git Bash reads "C:\..." as a host called C.
    run('scp', scpArgs(cfg, tgzName, release), { cwd: stageRoot });
    const result = spawnSync('ssh', [...ssh, activateCmd], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
    });
    log = result.stdout ?? '';
    process.stdout.write(log);
    if (result.error) throw new Error(`ssh could not start: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(
        `Activation failed on the server (exit ${result.status}). The live site was not switched ` +
          'unless the log above says SNAP_ACTIVE.',
      );
    }
  }

  // 5. Rollback and next steps.
  const previous = /^SNAP_PREVIOUS=(.*)$/m.exec(log)?.[1]?.trim() ?? '';
  say(`\nLive: ${release}`);
  if (previous) {
    const rollback = switchCommand(cfg, previous);
    say(`To roll back to the previous release (${previous}), run:`);
    say(local ? `  (Git Bash) ${rollback}` : `  ${printable('ssh', [...ssh, rollback])}`);
  } else {
    say('First release here: nothing to roll back to yet.');
  }
  say('\nNow run the smoke test:');
  say(local ? '  (local folder: nothing serves it)' : `  node deploy/smoke.ts --url ${LIVE_URL}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\nDeploy stopped: ${message}\n`);
    process.exit(1);
  });
}
