import { describe, expect, it } from 'vitest';
import type { ImageJobResult } from '@/core/contracts/image';
import { formatBytes, formatTimeLeft, sizeChange } from './format';
import { planJobs, type JobEntry } from './job-plan';
import { baseName, outputFileName, outputFileNames } from './names';
import { resultNotes } from './notes';
import { isImageJobResult } from './use-image-jobs';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [830, '830 B'],
    [1024, '1.0 KB'],
    [4300, '4.2 KB'],
    [38 * 1024, '38 KB'],
    [1024 * 1024 - 10, '1 MB'],
    [3.4 * 1024 * 1024, '3.4 MB'],
    [12.6 * 1024 * 1024, '13 MB'],
    [2 * 1024 ** 3, '2.0 GB'],
  ])('%d bytes → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('shows a dash for nonsense', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('formatTimeLeft', () => {
  it('says how much time is left', () => {
    expect(formatTimeLeft(null)).toBe('estimating time…');
    expect(formatTimeLeft(Number.NaN)).toBe('estimating time…');
    expect(formatTimeLeft(0.2)).toBe('about 1 s left');
    expect(formatTimeLeft(40)).toBe('about 40 s left');
    expect(formatTimeLeft(185)).toBe('about 3 min left');
  });
});

describe('sizeChange', () => {
  it('reports smaller, larger and same in whole percent', () => {
    expect(sizeChange(1000, 350)).toEqual({ kind: 'smaller', percent: 65 });
    expect(sizeChange(1000, 1170)).toEqual({ kind: 'larger', percent: 17 });
    expect(sizeChange(1000, 1000)).toEqual({ kind: 'same' });
  });

  it('never says "0%" for a real difference', () => {
    expect(sizeChange(100_000, 100_100)).toEqual({ kind: 'larger', percent: 1 });
    expect(sizeChange(100_000, 99_900)).toEqual({ kind: 'smaller', percent: 1 });
  });

  it('treats an empty original as "same"', () => {
    expect(sizeChange(0, 10)).toEqual({ kind: 'same' });
  });
});

describe('planJobs', () => {
  const entries = (list: Array<[string, string, string]>) =>
    new Map<string, JobEntry>(list.map(([file, jobId, signature]) => [file, { jobId, signature }]));

  it('queues every new file', () => {
    expect(planJobs(['a', 'b'], new Map(), 's1')).toEqual({
      remove: [],
      forget: [],
      add: ['a', 'b'],
    });
  });

  it('leaves files that already have a job with the same settings', () => {
    const plan = planJobs(['a', 'b', 'c'], entries([['a', 'j1', 's1']]), 's1');
    expect(plan).toEqual({ remove: [], forget: [], add: ['b', 'c'] });
  });

  it('replaces out-of-date jobs when the settings change', () => {
    const plan = planJobs(
      ['a', 'b'],
      entries([
        ['a', 'j1', 's1'],
        ['b', 'j2', 's1'],
      ]),
      's2',
    );
    expect(plan).toEqual({ remove: ['j1', 'j2'], forget: [], add: ['a', 'b'] });
  });

  it('removes the jobs of removed files', () => {
    const plan = planJobs(
      ['b'],
      entries([
        ['a', 'j1', 's1'],
        ['b', 'j2', 's1'],
      ]),
      's1',
    );
    expect(plan).toEqual({ remove: ['j1'], forget: ['a'], add: [] });
  });

  it('puts the file on screen first', () => {
    expect(planJobs(['a', 'b', 'c'], new Map(), 's', 'c').add).toEqual(['c', 'a', 'b']);
    expect(planJobs(['a', 'b'], new Map(), 's', 'missing').add).toEqual(['a', 'b']);
  });
});

describe('output names', () => {
  it('keeps the original name with the new extension by default', () => {
    expect(
      outputFileName({ fileName: 'IMG_1.HEIC', n: 1, width: 4032, height: 3024, format: 'jpeg' }),
    ).toBe('IMG_1.jpg');
    expect(baseName('photo.final.png')).toBe('photo.final');
    expect(baseName('.hidden')).toBe('.hidden');
  });

  it('fills in the pattern', () => {
    expect(
      outputFileName(
        { fileName: 'beach.png', n: 3, width: 1000, height: 750, format: 'webp' },
        '{name}-{width}x{height}-{n}.{format}',
      ),
    ).toBe('beach-1000x750-3.webp.webp');
    expect(
      outputFileName(
        { fileName: 'beach.png', n: 3, width: 1000, height: 750, format: 'png' },
        '{name}-{width}x{height}',
      ),
    ).toBe('beach-1000x750.png');
  });

  it('makes every name unique, ignoring case', () => {
    const item = { n: 1, width: 96, height: 64, format: 'jpeg' as const };
    expect(
      outputFileNames(
        [
          { ...item, fileName: 'a.jpg' },
          { ...item, fileName: 'A.png' },
          { ...item, fileName: 'a.webp' },
          { ...item, fileName: 'b.jpg' },
        ],
        '{name}-{width}x{height}',
      ),
    ).toEqual(['a-96x64.jpg', 'A-96x64 (2).jpg', 'a-96x64 (3).jpg', 'b-96x64.jpg']);
  });

  it('makes unsafe names safe', () => {
    expect(
      outputFileName({ fileName: 'x.jpg', n: 1, width: 1, height: 1, format: 'jpeg' }, 'a/b:c'),
    ).toBe('abc.jpg');
  });
});

describe('resultNotes', () => {
  const result = (
    notes: ImageJobResult['notes'],
    bytes = 500,
    format: ImageJobResult['format'] = 'jpeg',
  ) => ({ notes, bytes, format });

  it('says plainly when the result is bigger than the original', () => {
    expect(resultNotes(result([], 2000, 'webp'), { bytes: 1000, resized: false })).toEqual([
      {
        id: 'larger',
        text: 'Larger than the original — WebP at full size; try resizing.',
        tone: 'warn',
      },
    ]);
    expect(resultNotes(result([], 2000), { bytes: 1000, resized: true })[0]?.text).toMatch(
      /lower quality or another format/,
    );
  });

  it('calls a bigger JPG from a HEIC photo normal', () => {
    expect(resultNotes(result([], 2000), { bytes: 1000, resized: false, heic: true })).toEqual([
      expect.objectContaining({ id: 'larger', tone: 'info' }),
    ]);
  });

  it('turns pipeline notes into plain words', () => {
    const notes = resultNotes(
      result([
        'kept-original',
        'not-enlarged',
        'padded',
        'cropped',
        'format-fallback',
        'metadata-jpeg-only',
        'guard-short',
        'reduced-decode',
      ]),
      { bytes: 1000, resized: false },
    );
    expect(notes.map((n) => n.id)).toEqual([
      'kept',
      'not-enlarged',
      'padded',
      'cropped',
      'fallback',
      'jpeg-only',
      'grainy',
    ]);
    expect(notes.find((n) => n.id === 'fallback')?.text).toMatch(/^Saved as JPG/);
    expect(notes.every((n) => n.tone === 'info')).toBe(true);
  });

  it('never calls a kept original bigger', () => {
    expect(resultNotes(result(['kept-original'], 1000), { bytes: 1000, resized: false })).toEqual([
      expect.objectContaining({ id: 'kept' }),
    ]);
  });
});

describe('isImageJobResult', () => {
  it('accepts a pipeline result and rejects anything else', () => {
    const ok = {
      blob: new Blob(['x']),
      name: 'a.jpg',
      width: 1,
      height: 1,
      bytes: 1,
      format: 'jpeg',
      notes: [],
    };
    expect(isImageJobResult(ok)).toBe(true);
    expect(isImageJobResult({ ...ok, blob: 'x' })).toBe(false);
    expect(isImageJobResult(null)).toBe(false);
    expect(isImageJobResult(undefined)).toBe(false);
  });
});
