# Response headers for launch (P24 → P25)

Every response under `https://crkayes.com/snap-convert/` needs the headers below. P25 turns this into
`deploy/nginx-snap-convert.conf`. Checked by P24 against the production build: `e2e/csp.spec.ts`
serves every same-origin response with exactly this policy and runs every page, the image engine
(worker + wasm codecs), the HEIC decoder (libheif wasm), pdf.js thumbnails, pdf-lib merge, Bulk with
the ZIP worker and a toast in Chromium and WebKit, with no CSP violation and no console error.

## Content-Security-Policy

One policy for the whole site, sent on every response (HTML, JS, wasm, workers):

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' <INLINE_SCRIPT_HASHES>;
worker-src 'self' blob:;
img-src 'self' blob: data:;
style-src 'self' 'unsafe-inline';
font-src 'self';
connect-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'self'
```

(Sent as one line, directives separated by `; `.)

### Why each part is there

| Directive | Why |
| --- | --- |
| `script-src 'self'` + hashes | All code is our own. The pre-rendered pages contain **inline scripts** that must run: the theme script (P02, no flash of the wrong theme), the install-prompt capture (P21), and React Router's hydration scripts (`window.__reactRouterContext`, the per-page `import(...)` bootstrap, the stream enqueue/close calls, React's `$RB`/`$RC` Suspense scripts, scroll restoration). Each is allowed by its `sha256-` hash. No `'unsafe-inline'`, no `'unsafe-eval'`. |
| `'wasm-unsafe-eval'` | Compiling WebAssembly (jSquash codecs, libheif, pdf.js's wasm decoders). Needed in workers too, which is why the header goes on JS responses as well. |
| `worker-src 'self' blob:` | Image, PDF and ZIP workers are same-origin files; `blob:` is for any worker a library builds from a blob URL. |
| `img-src 'self' blob: data:` | Previews and results are shown from `blob:` URLs; some UI images are `data:` URLs. |
| `style-src 'self' 'unsafe-inline'` | Libraries insert `<style>` elements at runtime (sonner injects its toast CSS when it loads; Radix dialogs add a scroll-lock style with a measured value), so hashes can't cover them. **Tested:** with `style-src 'self'` every page reports two `style-src-elem` violations in Chromium and WebKit. Inline styles cannot run code, so the risk is low. |
| `connect-src 'self'` | Engine files, pdf.js CMaps and fonts, the sample photo, route data — all same-origin. The cookie-free counter (P23) must be served **same-origin** (e.g. `https://crkayes.com/umami/…`); if it is ever on another host, add that exact origin here. |
| `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'` | Standard hardening: no plugins, no `<base>` hijack, no off-site form posts, no framing by other sites (clickjacking). |

### The inline-script hashes change with every build

The bootstrap script of each page names the hashed asset files, so its hash changes whenever the
code changes. **The CSP must be generated from the build output on every deploy** (P25), never typed
by hand. Today's build has 35 distinct inline scripts across the 24 HTML files. The same algorithm
as `e2e/csp.spec.ts`:

```ts
// For every build/client/**/*.html (skip assets/): every <script> without src= and not
// type="application/json" / "application/ld+json" (JSON-LD is data, CSP does not apply to it).
const hash = `'sha256-${createHash('sha256').update(scriptText, 'utf8').digest('base64')}'`;
```

Write the result into an nginx include (e.g. `snap-convert-csp.conf` containing one
`add_header Content-Security-Policy "…" always;` line) that the location blocks include, and deploy it
together with the files. A stale include after a deploy breaks hydration on every page (the old
hashes don't match), so the post-deploy smoke test (P25) must check for CSP violations.

Notes:

- The service worker (P21) stores HTML with the headers it was fetched with, so a cached page keeps
  the policy that matches its own scripts. A new deploy is picked up when the service worker updates.
- A `<meta http-equiv="Content-Security-Policy">` per page would also work (each page only needs
  its own hashes), but it cannot carry `frame-ancestors`, and it doesn't cover workers. The header is
  preferred.
- Roll out with `Content-Security-Policy-Report-Only` for a day first if the owner wants extra safety;
  there is no report endpoint, so check the browser console on the live site.

## Other headers

| Header | Value | Why |
| --- | --- | --- |
| `Cross-Origin-Opener-Policy` | `same-origin` | Cross-origin isolation for multi-threaded WebAssembly (docs/05) |
| `Cross-Origin-Embedder-Policy` | `credentialless` | Same; `credentialless`, not `require-corp` (docs/05) |
| `X-Content-Type-Options` | `nosniff` | Files are only used as their declared type |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Outbound links (GitHub, credits) never see page paths with anything after `?`/`#` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | The app needs none of these. Choosing photos from the camera roll uses the file picker, not the camera permission |
| `X-Frame-Options` | `SAMEORIGIN` | Older browsers that ignore `frame-ancestors` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Only if crkayes.com doesn't already send it for the whole site |

Types and caching (from P21 and docs/05, repeated here so the config is in one place):

| Files | Header |
| --- | --- |
| `*.wasm` | `Content-Type: application/wasm` |
| `manifest.webmanifest` | `Content-Type: application/manifest+json` |
| `sw.js` | `Cache-Control: no-cache` |
| HTML, `*.data`, `sitemap.xml`, `robots.txt` | `Cache-Control: no-cache` |
| `assets/*` (hashed names), `icons/*`, `og/*`, fonts | `Cache-Control: public, max-age=31536000, immutable` |

## nginx gotcha

`add_header` in a nested `location` replaces **all** `add_header` lines of the outer block. Put the
security headers in one snippet and `include` it in every location block that sets its own
`Cache-Control`, or the long-cache block for `assets/` silently loses CSP, COOP and COEP — and
without COEP on worker scripts, cross-origin isolation breaks.
