import { afterAll, describe, expect, it } from 'vitest';
import { blobOf, fixture, runInWorker, startPdfWorker } from './ops/test-utils';

const { api, worker } = startPdfWorker();
afterAll(() => worker.terminate());

/** Runs `op` and returns the error message and how long it took to fail. */
async function failure(op: string, input: unknown): Promise<{ message: string; ms: number }> {
  const start = performance.now();
  try {
    await runInWorker(api, op, input);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ms: performance.now() - start,
    };
  }
  throw new Error(`${op} did not fail`);
}

describe('PDF worker: broken and protected files', () => {
  const ops = (file: unknown) =>
    [
      ['split', { file, mode: 'every-page' }],
      ['organize', { file, outName: 'x', pages: [{ index: 0, rotate: 0 }] }],
      ['resize-pages', { file, pageSize: 'a4', orientation: 'auto', outName: 'x' }],
    ] as const;

  it('password-protected PDF fails with the right message in under 2 s', async () => {
    const file = await fixture('encrypted.pdf');
    for (const [op, input] of ops(file)) {
      const { message, ms } = await failure(op, input);
      expect(message).toBe('This PDF is password-protected');
      expect(ms).toBeLessThan(2000);
    }
  });

  it('truncated PDF fails with the right message in under 2 s', async () => {
    const file = await fixture('truncated.pdf');
    for (const [op, input] of ops(file)) {
      const { message, ms } = await failure(op, input);
      expect(message).toBe('This PDF looks damaged');
      expect(ms).toBeLessThan(2000);
    }
  });

  it('a file that is not a PDF, or garbage after a PDF header, fails cleanly', async () => {
    const text = blobOf(new TextEncoder().encode('hello, not a pdf'), 'notes.pdf');
    expect((await failure('split', { file: text, mode: 'every-page' })).message).toBe(
      "This file isn't a PDF",
    );
    const junk = blobOf(
      new TextEncoder().encode('%PDF-1.7\n' + 'garbage '.repeat(500)),
      'junk.pdf',
    );
    expect((await failure('split', { file: junk, mode: 'every-page' })).message).toBe(
      'This PDF looks damaged',
    );
  });

  it('rejects unknown operations and malformed input', async () => {
    expect((await failure('compress', {})).message).toBe('Unknown PDF operation “compress”');
    expect((await failure('merge', { files: 'nope', outName: 'x' })).message).toBe(
      'The PDF settings are incomplete',
    );
    expect((await failure('split', null)).message).toBe('The PDF settings are incomplete');
  });

  it('keeps working after a failure', async () => {
    await failure('split', { file: await fixture('encrypted.pdf'), mode: 'every-page' });
    const { result } = await runInWorker(api, 'split', {
      file: await fixture('a4-3-pages.pdf'),
      mode: 'every-page',
    });
    expect(result.files).toHaveLength(3);
  });
});
