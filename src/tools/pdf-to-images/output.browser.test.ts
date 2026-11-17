// End to end on one thread: pages drawn by renderPageImage, encoded by the real image worker through
// the app's queue, exactly as the page does it (pageWork). Checks the crispness standard (D24):
// JPG at Auto scores SSIM ≥ 0.97 against the drawn page, PNG is pixel-identical.
//
// To look at the images yourself (the governor checks small text at 100%):
//   VITE_P31_SAVE_OUTPUT=1 pnpm vitest run --project browser src/tools/pdf-to-images/output.browser.test.ts
// writes them to test-results/pdf-to-images/.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { useQueue } from '@/core/queue';
import { ssim } from '@/engines/image';
import { renderPageImage } from '@/engines/pdf/render';
import { PageRunner, runStats, type PageWorkContext } from './runner';
import { DEFAULTS, pageFileName, type PdfToImagesSettings } from './settings';
import { describePageError, pageWork, type PageOutput } from './work';

const save = import.meta.env.VITE_P31_SAVE_OUTPUT === '1';

async function fixture(path: string): Promise<File> {
  const base64 = await commands.readFile(`tests/fixtures/${path}`, 'base64');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], path.split('/').pop()!, { type: 'application/pdf' });
}

async function pixels(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function writeOut(name: string, blob: Blob): Promise<void> {
  if (!save) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  await commands.writeFile(`test-results/pdf-to-images/${name}`, btoa(s), 'base64');
}

function context(): PageWorkContext {
  return { signal: new AbortController().signal, stage: () => {}, progress: () => {} };
}

function work(file: File, dpi: number, settings: Partial<PdfToImagesSettings> = {}) {
  return pageWork({
    file,
    pdfName: file.name,
    dpi,
    settings: { ...DEFAULTS, ...settings },
    queue: useQueue,
  });
}

let smallText: File;
let a4Three: File;

beforeAll(async () => {
  smallText = await fixture('pdf-to-images/small-text.pdf');
  a4Three = await fixture('pdf/a4-3-pages.pdf');
});

afterAll(() => {
  useQueue.getState().clear();
});

describe('PDF to images output', () => {
  it('a 3-page A4 PDF at 150 dpi gives 3 JPGs of exactly 1240 × 1754', async () => {
    const runner = new PageRunner<PageOutput>(work(a4Three, 150), {
      concurrency: 4,
      describeError: describePageError,
    });
    const finished = new Promise<void>((resolve) => {
      runner.subscribe((tasks) => {
        if (!runStats(tasks).running) resolve();
      });
    });
    runner.start([1, 2, 3]);
    await finished;
    const outputs = runner.tasks.map((t) => t.result!);
    expect(runner.tasks.map((t) => t.status)).toEqual(['done', 'done', 'done']);
    for (const out of outputs) {
      expect(out).toMatchObject({ width: 1240, height: 1754, format: 'jpeg', reduced: false });
      expect(out.blob.type).toBe('image/jpeg');
      const bitmap = await createImageBitmap(out.blob);
      expect([bitmap.width, bitmap.height]).toEqual([1240, 1754]);
      bitmap.close();
    }
    expect(
      outputs.map((o, i) =>
        pageFileName(DEFAULTS.rename, {
          pdfName: a4Three.name,
          page: i + 1,
          pageCount: 3,
          width: o.width,
          height: o.height,
          format: 'jpeg',
        }),
      ),
    ).toEqual(['a4-3-pages-p01.jpg', 'a4-3-pages-p02.jpg', 'a4-3-pages-p03.jpg']);
    // Each finished job was taken off the shared queue.
    expect(useQueue.getState().jobs).toEqual([]);
  });

  it('JPG at Auto looks the same as the drawn page (SSIM ≥ 0.97), small text included', async () => {
    for (const dpi of [72, 150, 300]) {
      const drawn = await renderPageImage(smallText, 0, dpi);
      const out = await work(smallText, dpi)(1, context());
      expect(out.format).toBe('jpeg');
      const score = ssim(await pixels(drawn.blob), await pixels(out.blob));
      expect(score, `${dpi} dpi`).toBeGreaterThanOrEqual(0.97);
      await writeOut(`small-text-${dpi}dpi.jpg`, out.blob);
      if (dpi === 150) await writeOut(`small-text-${dpi}dpi-drawn.png`, drawn.blob);
    }
  });

  it('PNG is lossless: decoded, it is identical to the drawn page', async () => {
    const drawn = await pixels((await renderPageImage(smallText, 0, 150)).blob);
    const out = await work(smallText, 150, { format: 'png' })(1, context());
    expect(out.format).toBe('png');
    expect(out.blob.type).toBe('image/png');
    const saved = await pixels(out.blob);
    expect([saved.width, saved.height]).toEqual([drawn.width, drawn.height]);
    expect(saved.data.every((v, i) => v === drawn.data[i])).toBe(true);
    await writeOut('small-text-150dpi.png', out.blob);
  });

  it("uses the user's own JPG quality when they choose it", async () => {
    const low = await work(smallText, 150, { qualityMode: 'custom', quality: 40 })(1, context());
    const auto = await work(smallText, 150)(1, context());
    expect(low.bytes).toBeLessThan(auto.bytes);
  });

  it('cancelling a page cancels its encoding job too', async () => {
    const controller = new AbortController();
    let encoding = false;
    const running = work(smallText, 300)(1, {
      signal: controller.signal,
      stage: (s) => {
        if (s === 'encoding') {
          encoding = true;
          // The job is on the queue now: stop it.
          queueMicrotask(() => controller.abort());
        }
      },
      progress: () => {},
    });
    await expect(running).rejects.toBeDefined();
    expect(encoding).toBe(true);
    await expect.poll(() => useQueue.getState().jobs.length).toBe(0);
  });
});
