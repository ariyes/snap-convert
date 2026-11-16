import { existsSync } from 'node:fs';
import { cp, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * React Router writes pre-rendered pages under the basename (build/client/snap-convert/…),
 * while the JS/CSS assets sit at build/client/assets/. We deploy build/client/ itself
 * as /snap-convert/, so move the pages up one level to sit next to the assets:
 *   build/client/snap-convert/index.html            → build/client/index.html
 *   build/client/snap-convert/compress-image/index.html → build/client/compress-image/index.html
 *
 * React Router also names its SPA fallback index.html when it finds no home page at the
 * root; that file is renamed back to __spa-fallback.html (for unknown URLs) before the move.
 */
export async function flattenPrerenderedPages(clientDir: string, basename: string): Promise<void> {
  const nestedDir = path.join(clientDir, ...basename.split('/').filter(Boolean));
  if (nestedDir === clientDir || !existsSync(nestedDir)) return;

  const rootIndex = path.join(clientDir, 'index.html');
  if (existsSync(path.join(nestedDir, 'index.html')) && existsSync(rootIndex)) {
    await rename(rootIndex, path.join(clientDir, '__spa-fallback.html'));
  }

  await cp(nestedDir, clientDir, { recursive: true, force: true });
  await rm(nestedDir, { recursive: true, force: true });
}
