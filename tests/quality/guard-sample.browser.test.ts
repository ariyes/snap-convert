// Sampled quality guard (P24b, F2): on huge images the guard finds its quality on a sample of
// full-resolution tiles, then encodes the full image once. This checks, on the reference photos
// and the 12 MP phone photo, that it makes the same decisions as guarding at full size: forced on
// ('always') vs. off ('never'), same quality, same guard steps, same outcome. Prints a table.
//
// Part of `pnpm quality` (and `VITE_IMAGE_NO_CANVAS=1 pnpm quality`). The generated 48 MP photo
// (tests/fixtures/real/generated/photo-48mp.jpg, made by `E2E_REAL=1 pnpm e2e real-world`) is
// added with VITE_QUALITY_48MP=1: slow, ~1 minute.
import * as Comlink from 'comlink';
import { afterAll, describe, expect, it } from 'vitest';
import { QUALITY_FLOOR, type ImageJobInput, type ImageJobResult } from '@/core/contracts/image';
import { presetJob, type GuardSampleMode } from '@/engines/optimize';
import type { GuardSampleWorkerApi } from './guard-sample-worker';
import { fixture, noCanvasMode, startImageWorker, twelveMegapixelJpeg } from './image-worker';

const PHOTOS = [
  'photo-fine-detail.jpg',
  'photo-night-noise.jpg',
  'photo-portrait-exif-rotated.jpg',
] as const;

const worker = new Worker(new URL('./guard-sample-worker.ts', import.meta.url), { type: 'module' });
const api = Comlink.wrap<GuardSampleWorkerApi>(worker);
afterAll(() => {
  worker.terminate();
  // eslint-disable-next-line no-console -- printing the comparison is this file's job
  console.log(formatTable());
});

interface Pair {
  image: string;
  run: string;
  full: ImageJobResult;
  fullMs: number;
  sampled: ImageJobResult;
  sampledMs: number;
}
const pairs: Pair[] = [];

async function timed(input: ImageJobInput, mode: GuardSampleMode) {
  const start = performance.now();
  const result = await api.run(input, mode, !noCanvasMode);
  return { result, ms: performance.now() - start };
}

const runs: Array<[string, (file: Blob, name: string) => ImageJobInput]> = [
  ['default JPEG', (file, name) => defaults(file, name, 'jpeg')],
  ['default WEBP', (file, name) => defaults(file, name, 'webp')],
  ['preset wordpress', (file, name) => presetJob('wordpress', file, name)],
];

function defaults(file: Blob, name: string, format: 'jpeg' | 'webp'): ImageJobInput {
  return { file, name, format, quality: 80, metadata: 'strip-all', qualityGuard: true };
}

async function compare(image: string, file: Blob, run: string, input: ImageJobInput) {
  const full = await timed(input, 'never');
  const sampled = await timed(input, 'always');
  pairs.push({
    image,
    run,
    full: full.result,
    fullMs: full.ms,
    sampled: sampled.result,
    sampledMs: sampled.ms,
  });
  const what = `${image} · ${run}`;
  const f = full.result;
  const s = sampled.result;
  expect([s.width, s.height], what).toEqual([f.width, f.height]);
  // The same decision: same quality, guard steps and outcome.
  expect(s.quality, what).toBe(f.quality);
  expect(s.guard, what).toEqual(f.guard);
  expect(s.ssim, what).toBeGreaterThanOrEqual(
    f.guard?.reached ? QUALITY_FLOOR.defaultSsim : QUALITY_FLOOR.minSsim,
  );
  // At most the predicted encode plus the capped extra steps at full size.
  if (f.width * f.height > 2_000_000) expect(s.encodes ?? 0, what).toBeLessThanOrEqual(3);
}

describe('sampled guard makes the same decisions as the full-size guard', () => {
  it.each(PHOTOS)(
    '%s',
    async (image) => {
      const file = await fixture(`quality/${image}`);
      for (const [run, input] of runs) await compare(image, file, run, input(file, image));
    },
    300_000,
  );

  it('12 MP phone photo (iPhone 7, 4032×3024 JPEG)', async () => {
    const app = startImageWorker();
    const big = await twelveMegapixelJpeg(app);
    app.stop();
    const name = 'iphone-7 (12 MP JPEG)';
    for (const [run, input] of runs) await compare(name, big, run, input(big, name));
  }, 300_000);

  it.runIf(import.meta.env.VITE_QUALITY_48MP === '1')(
    '48 MP generated photo (8000×6000 JPEG)',
    async () => {
      const big = await fixture('real/generated/photo-48mp.jpg');
      await compare('photo-48mp.jpg', big, 'default keep format', {
        ...defaults(big, 'photo-48mp.jpg', 'jpeg'),
        format: 'keep',
      });
    },
    600_000,
  );
});

function formatTable(): string {
  const header = [
    'Image',
    'Run',
    'Size',
    'Q full/sampled',
    'Guard',
    'SSIM full/sampled',
    'Encodes',
    'ms full → sampled',
  ];
  const lines = pairs.map((p) => [
    p.image,
    p.run,
    `${p.full.width}×${p.full.height}`,
    `${p.full.quality} / ${p.sampled.quality}`,
    p.full.guard ? `${p.full.guard.steps}${p.full.guard.reached ? '' : ' (short)'}` : '–',
    `${p.full.ssim.toFixed(4)} / ${p.sampled.ssim.toFixed(4)}`,
    `${p.full.encodes ?? 0} → ${p.sampled.encodes ?? 0}`,
    `${Math.round(p.fullMs)} → ${Math.round(p.sampledMs)}`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i]!.length)));
  const fmt = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`;
  return [
    '',
    `Sampled quality guard vs full-size guard (${noCanvasMode ? 'canvas-free' : 'canvas'} mode)`,
    fmt(header),
    fmt(widths.map((w) => '-'.repeat(w))),
    ...lines.map(fmt),
    '',
  ].join('\n');
}
