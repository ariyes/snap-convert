# Launch checklist (P25)

Everything the owner does to put Snap Convert live at **https://crkayes.com/snap-convert/** and
announce it. Work top to bottom; each step says how to check it worked. The governor can help in
session with any step.

Commands are for **PowerShell on the Windows machine** unless they say "on the server". Run them from
the project folder (`C:\Users\kayes\Documents\Web Apps\Snap Convert`).

What the deploy kit does, in one paragraph: `deploy\deploy.ps1` builds the app, checks every path is
under `/snap-convert/`, generates the Content-Security-Policy for that exact build, packs everything
into one file, copies it to the server with `scp`, unpacks it into a new timestamped release folder,
switches the live site to it in one step, reloads nginx, keeps the last 3 releases and prints the
command that switches back. Nothing about the server is stored in the repository except the example
settings file.

---

## 1. On this computer (once)

- [ ] **Tools.** `node -v` (26.x), `pnpm -v` (12.x), `ssh -V`, `tar --version`. If `ssh` is missing:
  Settings → Apps → Optional features → add **OpenSSH Client**.
- [ ] **Packages and test browsers.**
  ```powershell
  pnpm install --frozen-lockfile
  pnpm exec playwright install chromium webkit
  ```
- [ ] **SSH key login** to the server works without a password prompt:
  ```powershell
  ssh YOUR_USER@YOUR_SERVER "echo ok"
  ```
  If you use a passphrase, let Windows remember it once per session (run PowerShell as
  administrator for the first two lines, once):
  ```powershell
  Get-Service ssh-agent | Set-Service -StartupType Automatic
  Start-Service ssh-agent
  ssh-add $HOME\.ssh\id_ed25519
  ```
  (Use your key's file name.) The deploy connects twice (copy, then switch).

## 2. On the server (once)

Log in: `ssh YOUR_USER@YOUR_SERVER`.

- [ ] **Find how FXPad is served**, so Snap Convert sits next to it in the same `server { }` block:
  ```sh
  grep -rn "fxpad" /etc/nginx/
  ```
  Note the file that has crkayes.com's `server { … listen 443 … }` block (for example
  `/etc/nginx/sites-available/crkayes.com`). You'll add one line to it in step 5.
- [ ] **Check nginx** supports what the config uses:
  ```sh
  nginx -v
  nginx -V 2>&1 | grep -o -e http_gzip_static_module -e brotli
  ```
  `http_gzip_static_module` should be listed (it is in the Ubuntu/Debian packages). If it is not,
  delete the line `gzip_static on;` from `deploy/nginx-snap-convert.conf` (files are then
  compressed on the fly instead). If `brotli` is listed, you may un-comment `brotli_static on;`.
- [ ] **Create the folder** the deploy writes to, owned by your login (not root):
  ```sh
  sudo mkdir -p /var/www/snap-convert
  sudo chown "$USER": /var/www/snap-convert
  ```
  If you pick another folder, use it in `DEPLOY_PATH` (step 3) **and** replace every
  `/var/www/snap-convert` in `deploy/nginx-snap-convert.conf` (one `root`, six `include` lines).
- [ ] **Let the deploy reload nginx** without a password, for exactly two commands. First check the
  paths: `command -v nginx systemctl` (usually `/usr/sbin/nginx` and `/usr/bin/systemctl`). Then:
  ```sh
  sudo visudo -f /etc/sudoers.d/snap-convert-deploy
  ```
  and add this one line (your login name instead of `YOUR_USER`, your paths if different):
  ```
  YOUR_USER ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx
  ```
  Check: `sudo -n nginx -t` prints "syntax is ok" without asking for a password.
- [ ] **HSTS.** Run `curl -sI https://crkayes.com/ | grep -i strict-transport`. If it prints a line,
  copy its value (e.g. `max-age=31536000; includeSubDomains`) into `DEPLOY_HSTS` in step 3.
  Reason: nginx drops `add_header` lines from outer blocks inside a location that sets its own,
  so `/snap-convert/` only sends HSTS if the deploy adds it. If it prints nothing, leave
  `DEPLOY_HSTS` empty (turning HSTS on for the whole domain is a separate decision).
- [ ] **CDN?** If crkayes.com is behind a CDN (e.g. Cloudflare's proxy), it must pass the response
  headers through unchanged and must not cache HTML longer than nginx says (`no-cache`).

## 3. Deploy settings (once)

- [ ] Copy `deploy\.env.example` to `deploy\.env` (git-ignored) and fill in:

  | Setting | What to put |
  |---|---|
  | `DEPLOY_HOST` | the server's name or IP (or a Host alias from `~\.ssh\config`) |
  | `DEPLOY_USER` | your SSH login |
  | `DEPLOY_PORT` | `22` unless your SSH runs elsewhere |
  | `DEPLOY_SSH_KEY` | empty, or the *path* to the key file if it isn't your default key |
  | `DEPLOY_PATH` | `/var/www/snap-convert` (or your folder from step 2) |
  | `DEPLOY_KEEP` | `3` |
  | `DEPLOY_RELOAD` | leave as it is |
  | `DEPLOY_CSP_REPORT_ONLY` | `1` for the first day (see step 6), then `0` |
  | `DEPLOY_HSTS` | from step 2 |

  **Never** put a password, private key or token in this file.
- [ ] **Dry run** (builds and packs, then prints the `scp`/`ssh` commands without connecting):
  ```powershell
  powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -DryRun
  ```
  Check the end of the output: "Build check passed", "CSP: 35 inline-script hashes" (the number
  changes with the code), and two commands that name your server and folder.

## 4. First deploy

- [ ] Deploy:
  ```powershell
  powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
  ```
  It ends with `Live: <release>` and "First release here: nothing to roll back to yet."
- [ ] On the server, check the result:
  ```sh
  ls -l /var/www/snap-convert          # current -> releases/<release>, security-headers.conf
  head -3 /var/www/snap-convert/current/deploy/release.json
  ```
  The site isn't served yet (nginx doesn't know about it until step 5).

## 5. Install the nginx block (once)

- [ ] Copy the config to the server and into nginx's snippets folder:
  ```powershell
  scp deploy\nginx-snap-convert.conf YOUR_USER@YOUR_SERVER:/tmp/snap-convert.conf
  ```
  on the server:
  ```sh
  sudo mkdir -p /etc/nginx/snippets
  sudo cp /tmp/snap-convert.conf /etc/nginx/snippets/snap-convert.conf
  ```
- [ ] In crkayes.com's HTTPS `server { }` block (the file from step 2), add this line **above** the
  `location /` that passes requests to Next.js (next to the FXPad block is a good place):
  ```nginx
  include /etc/nginx/snippets/snap-convert.conf;
  ```
- [ ] Test and reload:
  ```sh
  sudo nginx -t && sudo systemctl reload nginx
  ```
  This is the `nginx -t` check the deploy kit could not run here (no nginx or Docker on the
  Windows machine). If it reports an error, send the message to the governor. Known causes:
  `unknown directive "gzip_static"` (see step 2), a path that doesn't match your folder, or an
  existing `location /snap-convert` block (remove the old one).
- [ ] Quick look: `curl -sI https://crkayes.com/snap-convert/` shows `200`, `cross-origin-opener-policy`,
  `cross-origin-embedder-policy` and `content-security-policy-report-only` (or
  `content-security-policy`).

## 6. Smoke test the live site

- [ ] Run the smoke test:
  ```powershell
  node deploy/smoke.ts --url https://crkayes.com/snap-convert/
  ```
  In Chromium and WebKit it checks: every page returns 200 with the security headers and a CSP
  that matches the page's scripts; `/snap-convert` redirects; unknown URLs give a 404 with the
  not-found page; `.wasm` is `application/wasm`; assets are cached for a year and compressed;
  `sw.js` and pages are `no-cache`; the home page hydrates; a sample compress and a sample merge
  work; no console errors, CSP violations or requests to other sites. All lines must say PASS.
- [ ] By hand: open the site in Chrome on the computer, Safari on an iPhone and Chrome on an Android
  phone. Try "Try with a sample photo" on Compress image, and install the app from the header
  button (Chrome) or Share → Add to Home Screen (iPhone).
- [ ] **CSP Report-Only day.** With `DEPLOY_CSP_REPORT_ONLY=1` the policy only reports. Use the site
  normally for a day with the browser console open (F12 → Console): there should be no
  "Content Security Policy" messages. Then set `DEPLOY_CSP_REPORT_ONLY=0` and deploy again:
  ```powershell
  powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
  node deploy/smoke.ts --url https://crkayes.com/snap-convert/
  ```
  (Skip this day if you prefer: set `0` from the start.)

## 7. Every later deploy

- [ ] Commit your changes, then run `deploy\deploy.ps1` and `node deploy/smoke.ts --url
  https://crkayes.com/snap-convert/`. On a Mac or Linux machine, `sh deploy/deploy.sh` does the
  same.
- [ ] **Rollback.** Each deploy prints the exact command to go back to the release before it, e.g.:
  ```powershell
  ssh YOUR_USER@YOUR_SERVER "sh '/var/www/snap-convert/releases/<previous>/deploy/activate.sh' '/var/www/snap-convert' '<previous>' 3 'sudo -n nginx -t && sudo -n systemctl reload nginx'"
  ```
  To see which releases are there: `ssh YOUR_USER@YOUR_SERVER "ls /var/www/snap-convert/releases"`.
  Rolling back takes a second and rewrites the CSP for that release too.
- [ ] People who already have the app open get the new version after the "Refresh" prompt (the
  service worker never swaps code during a job).

## 8. Search engines: crkayes.com/robots.txt

Search engines only read `robots.txt` at the root of the site. Today
`https://crkayes.com/robots.txt` allows everything except `/admin`, `/api/` and `/preview`, so
nothing blocks `/snap-convert/`. It lists only the main sitemap.

- [ ] Add this line to crkayes.com's robots.txt (wherever the Next.js site produces it, e.g. a
  `robots.txt` in its `public/` folder or its robots route), next to the existing `Sitemap:`
  line:
  ```
  Sitemap: https://crkayes.com/snap-convert/sitemap.xml
  ```
  Don't add any `Disallow` that matches `/snap-convert/`.
- [ ] Check: `curl -s https://crkayes.com/robots.txt` shows both `Sitemap:` lines.
- [ ] Optional: in Google Search Console, submit `https://crkayes.com/snap-convert/sitemap.xml`.
  The "coming soon" tools (Remove background, RAW to JPG, PDF to images) are left out of the
  sitemap and marked `noindex` on purpose (D34).

## 9. Public GitHub repository and SOURCE_URL

The app's footer and header link to the source code (AGPL-3.0 requires it). The link today is
`https://github.com/crkayes/snap-convert` (`SOURCE_URL` in `src/app/site.ts`).

- [ ] Before publishing, know what goes public: the whole git history, including `docs/`,
  `prompts/`, `prototype/` and `CLAUDE.md`, and the author name and email on every commit
  (see them with `git log --format="%an <%ae>" | Sort-Object -Unique`). `.env`, `deploy/.env` and `tests/fixtures/real/owner/` are
  git-ignored and stay private. Check nothing else is: `git ls-files | Select-String "\.env"`
  should list only `.env.example` and `deploy/.env.example`.
- [ ] On GitHub, create a **public**, **empty** repository (no README, licence or .gitignore —
  the project has them). Name it `snap-convert` under the account `crkayes` to match
  `SOURCE_URL`. If the account or name differ, tell the governor the real URL first:
  `SOURCE_URL` must change, then build and deploy again.
- [ ] Push:
  ```powershell
  git remote add origin https://github.com/crkayes/snap-convert.git
  git push -u origin main
  ```
- [ ] Repository settings: description "Free, private image and PDF converter that runs in your
  browser", website `https://crkayes.com/snap-convert/`. GitHub should show "AGPL-3.0" from the
  `LICENSE` file.
- [ ] The **Actions** tab runs the CI workflow on the push (lint, types, tests, build, quality report
  and end-to-end tests in Chromium, **Firefox** and WebKit). This is where Firefox is covered
  (D26). It should finish green; if not, send the log to the governor.
- [ ] Check the live footer's "Source" link opens the repository.

## 10. Visit counting with Umami (optional)

Snap Convert counts nothing until this is set up: the privacy page then says "This copy of Snap
Convert has counting switched off".

- [ ] Run Umami on your own server, reachable on the **same origin**, e.g.
  `https://crkayes.com/umami` (an nginx `location /umami/` that proxies to Umami, configured with
  that base path). Same origin matters: the CSP only allows `connect-src 'self'`. If Umami ever
  lives on another host, the deploy adds that origin to the CSP automatically from
  `VITE_UMAMI_URL`.
- [ ] In Umami, add a website "Snap Convert" (domain `crkayes.com`) and copy its website ID.
- [ ] In the project folder, copy `.env.example` to `.env` (git-ignored) and set:
  ```
  VITE_UMAMI_URL=https://crkayes.com/umami
  VITE_UMAMI_WEBSITE_ID=<the id>
  ```
  Then deploy (the build reads `.env`).
- [ ] Check: the privacy page now says counts go to Umami on `crkayes.com`; Umami's dashboard shows a
  visit after you open a page (unless your browser sends Do Not Track / Global Privacy Control —
  Snap Convert then doesn't count you).
- [ ] **Re-read the privacy page's "What we count" section** against your Umami setup. It says Umami
  estimates "country, region and city" from the IP address. That is only true if your Umami has
  its GeoIP (location) database installed; if it doesn't, tell the governor so the wording is
  changed before or right after launch.

## 11. crkayes.com: app card, project page, blog post

Drafts are in this folder; the governor can adjust wording with you.

- [ ] **Icon** for the cards: `public/icons/icon-512.png` (the orange lightning-bolt mark).
- [ ] **Free apps card** on the home page and on `/projects/` ("Free apps"), and in `/apps`: text in
  [project-page.md](project-page.md#card) — name, status "Live", one line, "Open app" →
  `/snap-convert/`.
- [ ] **Project page** at `/projects/snap-convert`: [project-page.md](project-page.md). Screenshots:
  [screenshots/](screenshots/) (regenerate with `pnpm build` then `node deploy/screenshots.ts`).
- [ ] **Blog post** "Building Snap Convert": [blog-post.md](blog-post.md), category/tag "Snap
  Convert". It links to the project page, so publish them together.
- [ ] **Changelog / release notes**: [release-notes.md](release-notes.md) (the project page's
  Changelog entry 1.0.0 is its short form).
- [ ] Optional: change the home page's "Now building" line.
- [ ] Check: every link on the new pages works, including "Open app" and "Source code".

## 12. Real files from your phone (before or right after launch)

The automated tests use generated files and a few real photos. One run with your own files is
still open from P24:

- [ ] Put a handful of your own files in `tests\fixtures\real\owner\` (git-ignored, never
  committed): iPhone HEIC photos (with location on), Android JPEGs, a scanned PDF, a
  password-protected PDF, a large PDF.
- [ ] Run (about 5–10 minutes):
  ```powershell
  $env:E2E_REAL = '1'; $env:E2E_PORT = '4460'
  pnpm e2e real-world memory --project chromium-desktop --project chromium-phone
  Remove-Item Env:E2E_REAL, Env:E2E_PORT
  ```
- [ ] Look at the results in `test-results\real-world\owner-*` at 100 % zoom next to the originals:
  sharp, upright, no location data. Tell the governor what you see (and any failed test).

## 13. After launch

- [ ] Tell the governor: live URL works, smoke test output, GitHub URL, Umami yes/no. The governor
  marks P25 and stage 6 done in the docs and records `SOURCE_URL`.
- [ ] Keep `deploy\.env` backed up somewhere private (it is not in git).
