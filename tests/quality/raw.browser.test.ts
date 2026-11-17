// RAW quality report (P29, D24): the camera's JPEG (fast) against our full develop of the same
// file — downscaled luma SSIM ≥ 0.9 shows they match in content, tone and colour — and RAW files
// through the real image worker at default settings (crisp: SSIM ≥ 0.97, details kept, GPS rules).
// Needs `pnpm fixtures:raw`; skipped with a message without it. Part of `pnpm quality`
// (add `--silent=false` to see the table).
import * as Comlink from 'comlink';
import { afterAll, describe, expect, it } from 'vitest';
import { QUALITY_FLOOR, type ImageJobInput } from '@/core/contracts/image';
import { ssim } from '@/engines/image/quality';
import { haveRawFixtures, MISSING_RAW_FIXTURES, rawFixture } from '@/engines/raw/testing';
import type { DecodeFailure, DecodeSummary, RawTestApi } from '@/engines/raw/testing-worker';
import { runJob, startImageWorker } from './image-worker';

/** Files with a full-size camera JPEG. Asserted: the CR2 (the camera JPEG has no lens corrections). */
const PAIRS = [
  ['canon-1100d.cr2', true],
  ['nikon-d500.nef', false],
  ['pentax-k5iis.pef', false],
  ['canon-m50.cr3', false],
  ['samsung-nx500.srw', false],
] as const;

const have = await haveRawFixtures(...PAIRS.map((p) => p[0]));
if (!have) console.warn(MISSING_RAW_FIXTURES);

const rows: string[] = [];
afterAll(() => {
  // eslint-disable-next-line no-console -- printing the report is this file's job
  if (rows.length) console.log(['RAW quality', ...rows].join('\n'));
});

function ok(r: DecodeSummary | DecodeFailure): DecodeSummary {
  if (!r.ok) throw new Error(r.message);
  return r;
}

describe.skipIf(!have)('RAW: fast (camera JPEG) vs full develop', () => {
  const worker = new Worker(new URL('../../src/engines/raw/testing-worker.ts', import.meta.url), {
    type: 'module',
  });
  const api = Comlink.wrap<RawTestApi>(worker);
  afterAll(() => worker.terminate());

  it.each(PAIRS)(
    '%s',
    async (name, asserted) => {
      const file = await rawFixture(name);
      if (!file) throw new Error(MISSING_RAW_FIXTURES);
      const fast = ok(await api.decode(file, { mode: 'fast' }));
      const full = ok(await api.decode(file, { mode: 'full' }));
      expect(fast.notes).toEqual(['raw-preview']);
      expect([full.width, full.height]).toEqual([fast.width, fast.height]);
      const score = ssim(fast.thumb, full.thumb);
      rows.push(
        `${name.padEnd(20)} fast ${fast.ms.toFixed(0).padStart(5)} ms  full ${full.ms.toFixed(0).padStart(5)} ms  SSIM ${score.toFixed(3)}  mean luma ${fast.meanLuma.toFixed(0)} / ${full.meanLuma.toFixed(0)}`,
      );
      if (asserted) expect(score).toBeGreaterThanOrEqual(0.9);
    },
    180_000,
  );
});

describe.skipIf(!have)('RAW files through the image worker', () => {
  const worker = startImageWorker();
  afterAll(() => worker.stop());

  const job = (file: File, extra: Partial<ImageJobInput>): ImageJobInput => ({
    file,
    name: file.name,
    format: 'jpeg',
    quality: 80,
    metadata: 'strip-location',
    qualityGuard: true,
    ...extra,
  });

  it('fast (default): the camera JPEG, re-encoded crisply, camera details kept', async () => {
    const file = await rawFixture('canon-m50.cr3');
    const { result, ms } = await runJob(worker, job(file!, {}));
    rows.push(
      `job canon-m50.cr3 fast → ${result.width}×${result.height} JPEG q${result.quality} SSIM ${result.ssim.toFixed(4)} ${(result.bytes / 1e6).toFixed(1)} MB in ${ms.toFixed(0)} ms`,
    );
    expect(result.name).toBe('canon-m50.jpg');
    expect([result.width, result.height]).toEqual([6000, 4000]);
    expect(result.notes).toContain('raw-preview');
    expect(result.ssim).toBeGreaterThanOrEqual(
      result.guard?.reached ? QUALITY_FLOOR.defaultSsim : QUALITY_FLOOR.minSsim,
    );
    const { parse } = await import('exifr');
    const options = { tiff: true, exif: true, translateValues: false };
    const tags = (await parse(await result.blob.arrayBuffer(), options)) as
      Record<string, unknown> | undefined;
    expect(tags?.Model).toBe('Canon EOS M50');
    expect(tags?.Orientation).toBe(1);
  }, 180_000);

  it('full, resized for the web: developed, crisp, never stretched', async () => {
    const file = await rawFixture('pentax-k5iis.pef');
    const { result, ms } = await runJob(
      worker,
      job(file!, {
        raw: { mode: 'full', whiteBalance: 'as-shot', exposure: 0, highlights: 'clip' },
        resize: { mode: 'longest', value: 2048 },
      }),
    );
    rows.push(
      `job pentax-k5iis.pef full 2048 → ${result.width}×${result.height} JPEG q${result.quality} SSIM ${result.ssim.toFixed(4)} in ${ms.toFixed(0)} ms (${result.notes.join(', ')})`,
    );
    expect([result.width, result.height]).toEqual([2048, 1356]);
    expect(result.notes).not.toContain('raw-preview');
    expect(result.ssim).toBeGreaterThanOrEqual(
      result.guard?.reached ? QUALITY_FLOOR.defaultSsim : QUALITY_FLOOR.minSsim,
    );
  }, 180_000);
});
