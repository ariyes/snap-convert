# Real-world test files (P24)

Used by `e2e/real-world.spec.ts` and `e2e/memory.spec.ts`. Both are opt-in because they are slow:

```sh
E2E_REAL=1 E2E_PORT=4460 pnpm e2e real-world memory --project chromium-desktop --project chromium-phone
```

Outputs are written to `test-results/real-world/` for side-by-side inspection at 100 % zoom.

## `generated/` (git-ignored, made on first run)

Created by `e2e/support/real-fixtures.ts` the first time a test needs them, then reused. Delete the
folder to regenerate. About 26 MB in all.

| File                   | What it is                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `photo-48mp.jpg`       | 8000×6000 JPEG (48 MP, ~14 MB): `quality/photo-fine-detail.jpg` enlarged, with per-pixel noise     |
| `screenshot-text.png`  | 2880×1800 retina screenshot of the app's Privacy page (real UI text)                               |
| `logo-transparent.png` | 1024×1024 transparent logo with anti-aliased edges and a soft drop shadow                          |
| `report-300-pages.pdf` | 300 A4 pages of text, a bar chart on every tenth page (pdf-lib)                                    |
| `scanned-12-pages.pdf` | 12 A4 pages, each one 200 dpi greyish JPEG with tilted serif text and noise, like a scanner output |

Already in the repository and used as real-world inputs: `images/iphone-7.heic` (real iPhone 7
HEIC, 4032×3024, Display P3, with GPS), `quality/photo-portrait-exif-rotated.jpg` (real iPhone 4S
JPEG, EXIF orientation 6), the other real photos in `quality/`, and `pdf/encrypted.pdf` (real RC4
password-protected PDF).

## `owner/` (git-ignored)

Put your own files here (any names): phone photos (iPhone HEIC with GPS, Android JPEG), real scans,
real password-protected PDFs, large real PDFs. Images are run through Compress at default settings
and through Bulk; outputs land in `test-results/real-world/owner-*`. Never commit them: they may
contain personal data (location, faces, documents).
