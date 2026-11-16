# Snap Convert

Convert, resize, compress and clean up images and PDFs for free, right in your browser — without uploading anything.

Snap Convert is a static web app hosted at [crkayes.com/snap-convert/](https://crkayes.com/snap-convert/). All processing runs on your own device in Web Workers and WebAssembly; there is no server that sees your files.

## Privacy promise

- **Your files never leave your device.** No uploads, ever.
- **No accounts, no cookies, no ads, no trackers.** Visits and tool runs are counted with a cookie-free counter that never receives file names, sizes or contents.
- **Never stretched, never enlarged by default.** Images and PDF pages keep their proportions; exact sizes use "fit with padding" or "crop to fill".

## Requirements

- Node.js 26 (see `.nvmrc`)
- pnpm 12 (`packageManager` in `package.json`)

## Commands

| Command                                                | What it does                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `pnpm install`                                         | Install dependencies                                                             |
| `pnpm exec playwright install chromium firefox webkit` | Install the browsers used by tests (once)                                        |
| `pnpm dev`                                             | Start the dev server at `http://localhost:5173/snap-convert/`                    |
| `pnpm build`                                           | Build static files into `build/client/` (deploy that folder as `/snap-convert/`) |
| `pnpm preview`                                         | Serve the production build locally                                               |
| `pnpm lint`                                            | ESLint (no warnings allowed)                                                     |
| `pnpm format`                                          | Format with Prettier                                                             |
| `pnpm typecheck`                                       | Generate route types and run TypeScript                                          |
| `pnpm test`                                            | Unit tests (happy-dom) and browser tests (real Chromium)                         |
| `pnpm test:unit` / `pnpm test:browser`                 | One of the two test projects                                                     |
| `pnpm e2e`                                             | Playwright end-to-end tests: Chromium and WebKit at desktop and phone sizes      |
| `pnpm e2e:all`                                         | Same, plus Firefox (also on when `CI` or `E2E_FIREFOX=1` is set)                 |
| `pnpm quality`                                         | Image quality report (`tests/quality/`) in real Chromium                         |

Firefox e2e is opt-in because Playwright's Firefox build fails to launch on the Windows 10 dev machine (mozglue side-by-side error).

The dev and preview servers send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`; production must send the same headers.

## Project layout

See [docs/05-architecture.md](docs/05-architecture.md). Shared TypeScript contracts live in `src/core/contracts/`.

## License

Snap Convert is free software under the [GNU Affero General Public License v3.0](LICENSE).
