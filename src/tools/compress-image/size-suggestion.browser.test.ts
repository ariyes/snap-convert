// P20b: "Resize to N px" from a target-unreachable note always reaches the target. Runs Compress's
// real jobs through the app's image worker on the reference photos: the pipeline's estimate is
// checked by trying it (and stepped down when it misses), then the size offered must fit.
import { afterAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { runJob, startImageWorker } from '../../../tests/quality/image-worker';
import type { ImageJobResult } from '@/core/contracts/image';
import { COMPRESS_DEFAULTS, jobInput, jobOptions, type CompressSettings } from './settings';
import { checkSuggestion, needsSizeCheck, resizedSettings } from './use-size-suggestion';

const worker = startImageWorker();
afterAll(() => worker.stop());

async function readFile(path: string): Promise<Blob> {
  const binary = atob(await commands.readFile(path, 'base64'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

const run = async (input: Parameters<typeof runJob>[1]): Promise<ImageJobResult> =>
  (await runJob(worker, input)).result;

/** Reference photos and targets they can't reach at full size. */
const CASES: Array<[path: string, targetKb: number]> = [
  ['public/samples/compress-sample.jpg', 60],
  ['public/samples/compress-sample.jpg', 50],
  ['tests/fixtures/quality/photo-fine-detail.jpg', 150],
  ['tests/fixtures/quality/photo-night-noise.jpg', 60],
  ['tests/fixtures/quality/photo-product-on-white.jpg', 25],
  ['tests/fixtures/quality/photo-portrait-exif-rotated.jpg', 40],
];

describe('Resize to N px reaches the target', () => {
  it.each(CASES)(
    '%s under %i KB',
    async (path, targetKb) => {
      const blob = await readFile(path);
      const name = path.split('/').pop() ?? 'photo.jpg';
      const file = { file: new File([blob], name, { type: 'image/jpeg' }), name };
      const settings: CompressSettings = { ...COMPRESS_DEFAULTS, qualityMode: 'target', targetKb };

      const first = await run(jobInput(file, jobOptions(settings)));
      // Every case here is chosen to miss at full size, so the note and its button show.
      expect(needsSizeCheck(first, settings)).toBe(true);
      if (!needsSizeCheck(first, settings)) return;

      const checked = await checkSuggestion(run, file, settings, first.suggestedSize);
      expect(checked.verified).toBe(true);
      expect(checked.tries).toBeLessThanOrEqual(3);

      // Tapping the button: the same settings the note's patch applies.
      const after = await run(jobInput(file, jobOptions(resizedSettings(settings, checked.size))));
      expect(after.notes).not.toContain('target-unreachable');
      expect(after.bytes).toBeLessThanOrEqual(targetKb * 1024);
      expect(Math.max(after.width, after.height)).toBe(
        Math.max(checked.size.width, checked.size.height),
      );
    },
    300_000,
  );
});
