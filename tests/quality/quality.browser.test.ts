// Quality report (P12, image quality standard D24): every reference image in
// tests/fixtures/quality/ through the real image worker at default settings (JPEG, WebP, AVIF),
// every web preset and the target-size extremes. Prints size saved and SSIM for each, and fails if
// a default or preset result scores below 0.97, or anything at all below 0.95.
//
// Run with `pnpm quality` (add `--silent=false` in a non-interactive shell to see the table).
// `VITE_IMAGE_NO_CANVAS=1 pnpm quality` runs the same report without OffscreenCanvas in the
// worker, as in older Safari (P12b).
import { afterAll, describe, expect, it } from 'vitest';
import { QUALITY_FLOOR } from '@/core/contracts/image';
import type { ImageJobInput, ImageJobResult } from '@/core/contracts/image';
import { PRESET_IDS, presetJob } from '@/engines/optimize';
import {
  fixture,
  noCanvasMode,
  runJob,
  startImageWorker,
  twelveMegapixelJpeg,
  type ImageWorker,
} from './image-worker';

const IMAGES = [
  'photo-fine-detail.jpg',
  'photo-night-noise.jpg',
  'photo-product-on-white.jpg',
  'photo-portrait-exif-rotated.jpg',
  'sky-gradient.png',
  'text-screenshot.png',
  'line-art-logo.png',
] as const;

/** Target-size extremes: far too small (must stop at the floor, not smear) and generous. */
const TARGET_LOW = 25_000;
const TARGET_HIGH = 10_000_000;

type Kind = 'default' | 'preset' | 'target';

interface Run {
  label: string;
  kind: Kind;
  input: (file: Blob, name: string) => ImageJobInput;
}

const base = (file: Blob, name: string): ImageJobInput => ({
  file,
  name,
  format: 'jpeg',
  quality: 80,
  metadata: 'strip-all',
});

const RUNS: Run[] = [
  ...(['jpeg', 'webp', 'avif'] as const).map((format): Run => ({
    label: `default ${format.toUpperCase()}`,
    kind: 'default',
    input: (file, name) => ({ ...base(file, name), format, qualityGuard: true }),
  })),
  {
    label: 'default keep format',
    kind: 'default',
    input: (file, name) => ({ ...base(file, name), format: 'keep', qualityGuard: true }),
  },
  ...PRESET_IDS.map((id): Run => ({
    label: `preset ${id}`,
    kind: 'preset',
    input: (file, name) => presetJob(id, file, name),
  })),
  {
    label: `target ${TARGET_LOW / 1000} KB`,
    kind: 'target',
    input: (file, name) => ({ ...base(file, name), targetBytes: TARGET_LOW }),
  },
  {
    label: `target ${TARGET_HIGH / 1_000_000} MB`,
    kind: 'target',
    input: (file, name) => ({ ...base(file, name), targetBytes: TARGET_HIGH }),
  },
];

interface Row {
  image: string;
  run: string;
  kind: Kind;
  inBytes: number;
  result: ImageJobResult;
  ms: number;
  extra?: string;
}

const rows: Row[] = [];
const workers: ImageWorker[] = [startImageWorker(), startImageWorker()];

afterAll(() => {
  for (const w of workers) w.stop();
  // eslint-disable-next-line no-console -- printing the report is this file's job
  console.log(formatTable(rows));
});

/** Runs jobs on the two workers, at most one job per worker at a time. */
async function runAll<T>(jobs: Array<(w: ImageWorker) => Promise<T>>): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(
    workers.map(async (w) => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]!(w);
      }
    }),
  );
  return results;
}

function check(row: Row): void {
  const { result, kind } = row;
  const what = `${row.image} · ${row.run}: SSIM ${result.ssim.toFixed(4)} at q${result.quality}`;
  // Nothing anywhere below 0.95.
  expect(result.ssim, what).toBeGreaterThanOrEqual(QUALITY_FLOOR.minSsim);
  // D30: a kept original is the untouched file, never bigger than the input.
  if (result.notes.includes('kept-original')) {
    expect(result.bytes, what).toBeLessThanOrEqual(row.inBytes);
    expect(result.ssim, what).toBe(1);
    return;
  }
  // Defaults and presets run the guard: ≥ 0.97 when it reached it (D24, D28); otherwise it
  // stopped at its cap and must say so.
  if (kind === 'default' || kind === 'preset') {
    if (result.guard?.reached) {
      expect(result.ssim, what).toBeGreaterThanOrEqual(QUALITY_FLOOR.defaultSsim);
    } else if (result.guard) {
      expect(result.notes, what).toContain('guard-short');
    }
  }
  // Lossless PNG has no guard; it must score ≈ 1 anyway.
  if (kind === 'default' && !result.guard)
    expect(result.ssim, what).toBeGreaterThanOrEqual(QUALITY_FLOOR.defaultSsim);
  if (kind === 'target')
    expect(result.quality, what).toBeGreaterThanOrEqual(QUALITY_FLOOR.minQuality);
}

describe('quality report: reference images through the image worker', () => {
  it.each(IMAGES)(
    '%s',
    async (image) => {
      const file = await fixture(`quality/${image}`);
      const done = await runAll(
        RUNS.map((run) => async (w) => {
          const { result, ms } = await runJob(w, run.input(file, image));
          const row: Row = {
            image,
            run: run.label,
            kind: run.kind,
            inBytes: file.size,
            result,
            ms,
          };
          if (result.notes.includes('target-unreachable') && result.suggestedSize) {
            // How good is the "resize to … to get under …" estimate? Try it.
            const s = result.suggestedSize;
            const retry = await runJob(w, {
              ...run.input(file, image),
              resize: { mode: 'longest', value: Math.max(s.width, s.height) },
            });
            const fits = !retry.result.notes.includes('target-unreachable');
            row.extra = `suggests ${s.width}×${s.height} → ${kb(retry.result.bytes)} ${fits ? 'fits' : 'still over'}`;
          }
          return row;
        }),
      );
      rows.push(...done);
      for (const row of done) check(row);
    },
    600_000,
  );

  it('12 MP phone photo (iPhone 7, 4032×3024 JPEG)', async () => {
    const [w] = workers;
    const big = await twelveMegapixelJpeg(w!);
    const name = 'iphone-7 (12 MP JPEG)';
    // Warm-up so the timing below doesn't include loading codecs.
    await runJob(w!, presetJob('thumbnail', big, name));
    const runs: Array<[string, Kind, ImageJobInput]> = [
      ['preset web (timed)', 'preset', presetJob('web', big, name)],
      ['target 200 KB, full size', 'target', { ...base(big, name), targetBytes: 200_000 }],
      [
        'target 200 KB, 1600 px',
        'target',
        { ...base(big, name), targetBytes: 200_000, resize: { mode: 'longest', value: 1600 } },
      ],
    ];
    for (const [label, kind, input] of runs) {
      const { result, ms } = await runJob(w!, input);
      const row: Row = { image: name, run: label, kind, inBytes: big.size, result, ms };
      if (result.suggestedSize) {
        row.extra = `suggests ${result.suggestedSize.width}×${result.suggestedSize.height}`;
      }
      rows.push(row);
      check(row);
    }
  }, 300_000);
});

// ---------- table ----------

function kb(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(2)} MB`
    : `${Math.round(bytes / 1000)} KB`;
}

function formatTable(all: Row[]): string {
  const kept = all.filter((r) => r.result.notes.includes('kept-original'));
  const scored = all.filter((r) => !r.result.notes.includes('kept-original'));
  const header = ['Image', 'Run', 'Output', 'Size', 'Saved', 'Q', 'SSIM', 'Guard', 'ms', 'Notes'];
  const lines = scored.map((r) => {
    const res = r.result;
    const saved = 1 - res.bytes / r.inBytes;
    const guard = res.guard ? `${res.guard.steps}${res.guard.reached ? '' : ' (short)'}` : '–';
    const notes = [...res.notes.filter((n) => n !== 'not-enlarged'), r.extra]
      .filter(Boolean)
      .join('; ');
    return [
      r.image,
      r.run,
      `${res.format} ${res.width}×${res.height}`,
      kb(res.bytes),
      `${(saved * 100).toFixed(0)}%`,
      String(res.quality),
      res.ssim.toFixed(4),
      guard,
      String(Math.round(r.ms)),
      notes,
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i]!.length)));
  const fmt = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`;
  return [
    '',
    'Quality report (SSIM vs the resized pixels; Guard = extra encodes by the quality guard)',
    noCanvasMode
      ? 'Mode: canvas-free (VITE_IMAGE_NO_CANVAS=1, worker without OffscreenCanvas, as older Safari)'
      : 'Mode: canvas (browser decoders)',
    fmt(header),
    fmt(widths.map((w) => '-'.repeat(w))),
    ...lines.map(fmt),
    '',
    'Kept original (D30: re-encoding was no smaller, so the original file was kept, metadata policy applied):',
    ...kept.map(
      (r) =>
        `- ${r.image} · ${r.run}: ${r.result.format} ${r.result.width}×${r.result.height}, ` +
        `${kb(r.result.bytes)} (input ${kb(r.inBytes)}), ${r.result.encodes ?? 0} encodes, ${Math.round(r.ms)} ms`,
    ),
    '',
  ].join('\n');
}
