// Tests for the deploy kit (P25). Node's own test runner, so nothing is added to the app's suite:
//   node --test deploy/
// (describe/test return promises the runner tracks itself, hence `void`.)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  checkBuild,
  codePathProblems,
  htmlPathProblems,
  manifestProblems,
  sitemapProblems,
} from './check-build.ts';
import { addHeader, headersTemplate, parseHeaders, renderHeaders, REPO_ROOT } from './csp.ts';
import {
  activateCommand,
  localShell,
  posixPath,
  readConfig,
  releaseName,
  shq,
  switchCommand,
} from './deploy.ts';
import {
  allowedScriptHashes,
  CACHE_IMMUTABLE,
  CACHE_NO_CACHE,
  CACHE_WEEK,
  contentSecurityPolicy,
  HASHES_PLACEHOLDER,
  inlineScripts,
  pathRule,
  scriptHash,
  SECURITY_HEADERS,
} from './headers.ts';
import { nginxResponseHeaders } from './local-nginx.ts';

const tmp = mkdtempSync(path.join(tmpdir(), 'snap-deploy-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

void describe('headers', () => {
  void test('the CSP is the one in docs/launch/headers.md', () => {
    const doc = readFileSync(path.join(REPO_ROOT, 'docs/launch/headers.md'), 'utf8');
    const block = /```\n(default-src[\s\S]*?)\n```/.exec(doc)?.[1] ?? '';
    const documented = block.replace(/;\n/g, '; ').replace('<INLINE_SCRIPT_HASHES>', 'H');
    assert.equal(contentSecurityPolicy({ scriptHashes: ['H'] }), documented);
  });

  void test('every other header in docs/launch/headers.md is sent', () => {
    const doc = readFileSync(path.join(REPO_ROOT, 'docs/launch/headers.md'), 'utf8');
    for (const [name, value] of SECURITY_HEADERS) {
      assert.ok(doc.includes(`| \`${name}\` | \`${value}\``), `${name}: ${value}`);
    }
  });

  void test('script hashes match what the browser computes', () => {
    const html =
      '<script>a()</script><script src="/x.js"></script>' +
      '<script type="application/ld+json">{}</script><script type="module" async="">b()</script>';
    assert.deepEqual(inlineScripts(html), ['a()', 'b()']);
    // printf 'a()' | openssl dgst -sha256 -binary | base64
    assert.equal(scriptHash('a()'), "'sha256-qVpDBgj7bpq5hMAcGp3AOc79J3Y1Z4HvySTwKrWDoy4='");
    const policy = contentSecurityPolicy({ scriptHashes: [scriptHash('a()')] });
    assert.deepEqual([...allowedScriptHashes(policy)], [scriptHash('a()')]);
  });

  void test('a counter on another origin is allowed in connect-src', () => {
    const policy = contentSecurityPolicy({ scriptHashes: [], extraConnect: ['https://u.example'] });
    assert.match(policy, /connect-src 'self' https:\/\/u\.example;/);
  });
});

void describe('security-headers.conf', () => {
  void test('template → rendered → parsed round trip', () => {
    const template = headersTemplate();
    assert.ok(template.includes(HASHES_PLACEHOLDER));
    const rendered = renderHeaders(template, ["'sha256-b='", "'sha256-a='", "'sha256-a='"]);
    const parsed = new Map(parseHeaders(rendered));
    assert.equal(parsed.size, SECURITY_HEADERS.length + 1);
    assert.match(parsed.get('Content-Security-Policy') ?? '', /'sha256-a=' 'sha256-b=';/);
  });

  void test('report-only and HSTS options', () => {
    const parsed = new Map(
      parseHeaders(headersTemplate({ reportOnly: true, hsts: 'max-age=31536000' })),
    );
    assert.ok(parsed.has('Content-Security-Policy-Report-Only'));
    assert.ok(!parsed.has('Content-Security-Policy'));
    assert.equal(parsed.get('Strict-Transport-Security'), 'max-age=31536000');
  });

  void test('refuses values nginx would misread', () => {
    assert.throws(() => addHeader('X-Test', 'a"b'));
    assert.throws(() => addHeader('X-Test', '$host'));
  });
});

/** Location blocks of the nginx config with their own (not nested) directives. */
function nginxLocations(conf: string): Array<{ match: string; own: string }> {
  const text = conf.replace(/#.*$/gm, '');
  const out: Array<{ match: string; own: string }> = [];
  const re = /location\s+([^{]+)\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    let own = '';
    for (; i < text.length && depth > 0; i += 1) {
      const c = text[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (depth === 1) own += c;
    }
    out.push({ match: (m[1] ?? '').trim(), own });
  }
  return out;
}

void describe('nginx-snap-convert.conf', () => {
  const conf = readFileSync(path.join(REPO_ROOT, 'deploy/nginx-snap-convert.conf'), 'utf8');
  const locations = nginxLocations(conf);
  const byMatch = (match: string) => {
    const found = locations.find((l) => l.match === match);
    assert.ok(found, `location ${match}`);
    return found.own;
  };

  void test('every block that sets headers includes the security headers', () => {
    for (const { match, own } of locations) {
      if (!own.includes('add_header')) continue;
      assert.match(own, /include \/var\/www\/snap-convert\/security-headers\.conf;/, match);
    }
  });

  void test('cache rules agree with pathRule() (used by the local stand-in)', () => {
    const cache = (own: string) => /add_header Cache-Control "([^"]+)" always;/.exec(own)?.[1];
    assert.equal(
      cache(byMatch('^~ /snap-convert/')),
      pathRule('/snap-convert/x.html').cacheControl,
    );
    assert.equal(
      cache(byMatch('^~ /snap-convert/assets/')),
      pathRule('/snap-convert/assets/a.js').cacheControl,
    );
    assert.equal(
      cache(byMatch('~ ^/snap-convert/(?:icons|og)/')),
      pathRule('/snap-convert/og/a.png').cacheControl,
    );
    assert.equal(pathRule('/snap-convert/icons/a.png').cacheControl, CACHE_WEEK);
    assert.equal(pathRule('/snap-convert/sw.js').cacheControl, CACHE_NO_CACHE);
    assert.equal(pathRule('/snap-convert/assets/a.wasm').cacheControl, CACHE_IMMUTABLE);
    for (const [match, file] of [
      ['~ \\.wasm$', '/snap-convert/assets/a.wasm'],
      ['~ \\.mjs$', '/snap-convert/assets/a.mjs'],
      ['= /snap-convert/manifest.webmanifest', '/snap-convert/manifest.webmanifest'],
    ] as const) {
      const own = byMatch(match);
      // `types { }` (the parser drops the empty braces): the map is emptied, default_type wins.
      assert.match(own, /\btypes\s+default_type /, match);
      assert.equal(/default_type ([^;]+);/.exec(own)?.[1], pathRule(file).contentType, match);
      assert.equal(cache(own), pathRule(file).cacheControl, match);
    }
  });

  void test('try_files, 404 page and redirect as in docs/05', () => {
    const main = byMatch('^~ /snap-convert/');
    assert.match(main, /try_files \$uri \$uri\/index\.html \$uri\.html =404;/);
    assert.match(main, /error_page 404 \/snap-convert\/__spa-fallback\.html;/);
    assert.match(main, /root \/var\/www\/snap-convert\/current;/);
    assert.match(byMatch('= /snap-convert'), /return 301 \/snap-convert\/;/);
  });

  void test('the local stand-in sends the same headers', () => {
    const security = parseHeaders(renderHeaders(headersTemplate(), ["'sha256-a='"]));
    const out = nginxResponseHeaders(
      '/snap-convert/assets/a.wasm',
      { 'content-type': 'application/octet-stream', 'cache-control': 'no-cache', etag: 'x' },
      security,
    );
    assert.equal(out['Content-Type'], 'application/wasm');
    assert.equal(out['Cache-Control'], CACHE_IMMUTABLE);
    assert.equal(out.etag, 'x');
    assert.equal(out['cache-control'], undefined);
    assert.equal(out['Cross-Origin-Embedder-Policy'], 'credentialless');
  });
});

void describe('build check', () => {
  void test('finds paths outside /snap-convert/', () => {
    assert.deepEqual(htmlPathProblems('a.html', '<a href="/snap-convert/x">'), []);
    assert.equal(htmlPathProblems('a.html', '<script src="/assets/x.js">').length, 1);
    assert.equal(htmlPathProblems('a.html', '<a href="http://localhost:5173/x">').length, 1);
    assert.equal(htmlPathProblems('a.html', '<a href="https://crkayes.com/blog">').length, 1);
    assert.deepEqual(htmlPathProblems('a.html', '<a href="https://crkayes.com/">'), []);
    assert.equal(codePathProblems('a.js', 'fetch("/assets/a.wasm")').length, 1);
    assert.equal(codePathProblems('a.css', 'url(/fonts/a.woff2)').length, 1);
    assert.deepEqual(codePathProblems('a.css', 'url(/snap-convert/assets/a.woff2)'), []);
    assert.equal(manifestProblems('{"start_url":"/","scope":"/","id":"/"}').length, 3);
    assert.equal(sitemapProblems('<loc>https://crkayes.com/x</loc>').length, 1);
  });

  void test('reports missing files and source maps', () => {
    const dir = path.join(tmp, 'build');
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<link href="/snap-convert/assets/a.css">');
    writeFileSync(path.join(dir, 'assets/a.js.map'), '{}');
    const { problems, pages } = checkBuild(dir);
    assert.deepEqual(pages, ['']);
    assert.ok(problems.includes('missing sw.js'));
    assert.ok(problems.includes('source map shipped: assets/a.js.map'));
    assert.ok(problems.includes('no .wasm files in assets/'));
  });
});

void describe('deploy settings and commands', () => {
  const env = { DEPLOY_HOST: 'example.com', DEPLOY_USER: 'deploy', DEPLOY_PATH: '/var/www/sc/' };

  void test('reads deploy/.env values', () => {
    const cfg = readConfig(env);
    assert.equal(cfg.path, '/var/www/sc');
    assert.equal(cfg.port, '22');
    assert.equal(cfg.keep, 3);
    assert.throws(() => readConfig({ ...env, DEPLOY_HOST: '' }), /DEPLOY_HOST/);
    assert.throws(() => readConfig({ ...env, DEPLOY_PATH: 'var/www' }), /DEPLOY_PATH/);
    assert.throws(() => readConfig({ ...env, DEPLOY_PATH: '/var/www/../etc' }), /DEPLOY_PATH/);
    assert.throws(() => readConfig({ ...env, DEPLOY_PATH: "/var/www/a'b" }), /DEPLOY_PATH/);
    assert.throws(() => readConfig({ ...env, DEPLOY_KEEP: '1' }), /DEPLOY_KEEP/);
    assert.throws(() => readConfig({ ...env, DEPLOY_RELOAD: 'echo $HOME' }), /DEPLOY_RELOAD/);
  });

  void test('release names sort by time', () => {
    assert.equal(
      releaseName(new Date('2026-11-17T09:05:03Z'), 'abc1234'),
      '20261117-090503-abc1234',
    );
    assert.equal(releaseName(new Date('2026-11-17T09:05:03Z'), ''), '20261117-090503');
  });

  void test('remote commands are quoted', () => {
    assert.equal(shq("it's"), `'it'\\''s'`);
    const cfg = readConfig(env);
    assert.equal(
      switchCommand(cfg, 'r1'),
      "sh '/var/www/sc/releases/r1/deploy/activate.sh' '/var/www/sc' 'r1' 3 " +
        "'sudo -n nginx -t && sudo -n systemctl reload nginx'",
    );
    assert.match(activateCommand(cfg, 'r1'), /^set -e; mkdir -p '\/var\/www\/sc\/releases'; /);
  });

  void test('Windows paths for Git sh', () => {
    assert.equal(posixPath('C:\\Users\\me\\x', 'win32'), '/c/Users/me/x');
  });
});

void describe('activate.sh', () => {
  let shell: ReturnType<typeof localShell> | undefined;
  try {
    shell = localShell();
  } catch {
    shell = undefined;
  }
  const app = path.join(tmp, 'app');
  const release = (name: string, hashes: string[]) => {
    const dir = path.join(app, 'releases', name);
    mkdirSync(path.join(dir, 'snap-convert'), { recursive: true });
    mkdirSync(path.join(dir, 'deploy'), { recursive: true });
    writeFileSync(path.join(dir, 'snap-convert/index.html'), name);
    writeFileSync(path.join(dir, 'deploy/headers.conf.template'), headersTemplate());
    writeFileSync(path.join(dir, 'deploy/script-hashes.txt'), `${hashes.join('\n')}\n`);
  };
  const activate = (name: string, reload: string, keep = 3) =>
    spawnSync(
      shell?.sh ?? 'sh',
      [
        posixPath(path.join(REPO_ROOT, 'deploy/remote/activate.sh')),
        posixPath(app),
        name,
        String(keep),
        reload,
      ],
      { env: shell?.env, encoding: 'utf8' },
    );
  // Read through sh: on Windows the test links are MSYS links, which Node can't read.
  const current = () =>
    spawnSync(shell?.sh ?? 'sh', ['-c', 'readlink current'], {
      cwd: app,
      env: shell?.env,
      encoding: 'utf8',
    }).stdout.trim();
  // Each reload appends the headers nginx would load to reloads.log.
  const logReload = 'cat security-headers.conf >> reloads.log && echo ---- >> reloads.log';
  const cspOf = (conf: string) => new Map(parseHeaders(conf)).get('Content-Security-Policy') ?? '';

  void test(
    'switches with both releases allowed in between, then the new one only',
    {
      skip: !shell && 'no POSIX sh',
    },
    () => {
      release('20260101-000000-a', ["'sha256-A='"]);
      release('20260102-000000-b', ["'sha256-B='"]);
      let r = activate('20260101-000000-a', logReload);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /SNAP_PREVIOUS=$/m);
      writeFileSync(path.join(app, 'reloads.log'), '');

      r = activate('20260102-000000-b', logReload);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^SNAP_ACTIVE=20260102-000000-b$/m);
      assert.match(r.stdout, /^SNAP_PREVIOUS=20260101-000000-a$/m);
      assert.equal(current(), 'releases/20260102-000000-b');
      const reloads = readFileSync(path.join(app, 'reloads.log'), 'utf8').split('----\n');
      assert.equal(allowedScriptHashes(cspOf(reloads[0] ?? '')).size, 2, 'both during the switch');
      const final = readFileSync(path.join(app, 'security-headers.conf'), 'utf8');
      assert.deepEqual([...allowedScriptHashes(cspOf(final))], ["'sha256-B='"]);
      // Same text as the TypeScript renderer (used by the local smoke test).
      assert.equal(final, renderHeaders(headersTemplate(), ["'sha256-B='"]));
    },
  );

  void test(
    'a failed nginx check leaves the live release and headers alone',
    {
      skip: !shell && 'no POSIX sh',
    },
    () => {
      release('20260103-000000-c', ["'sha256-C='"]);
      const before = readFileSync(path.join(app, 'security-headers.conf'), 'utf8');
      const r = activate('20260103-000000-c', 'false');
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /nothing was switched/);
      assert.equal(current(), 'releases/20260102-000000-b');
      assert.equal(readFileSync(path.join(app, 'security-headers.conf'), 'utf8'), before);
    },
  );

  void test('keeps the newest releases and rolls back', { skip: !shell && 'no POSIX sh' }, () => {
    release('20260104-000000-d', ["'sha256-D='"]);
    let r = activate('20260104-000000-d', 'true', 2);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /removed old release 20260101-000000-a/);
    // Rollback = activate the previous release again.
    r = activate('20260102-000000-b', 'true', 2);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(current(), 'releases/20260102-000000-b');
    assert.match(r.stdout, /^SNAP_PREVIOUS=20260104-000000-d$/m);
  });
});
