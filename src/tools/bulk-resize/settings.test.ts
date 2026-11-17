import { describe, expect, it } from 'vitest';
import { withQualityFlag } from '@/tools/_shared';
import {
  baseName,
  BULK_DEFAULTS,
  estimateBytes,
  estimateFileBytes,
  extensionFor,
  jobOptions,
  outputName,
  outputNames,
  plannedFormat,
  settingsSignature,
} from './settings';
import { formatBytes, formatTimeLeft } from './strings';

describe('Bulk defaults (IMG-08)', () => {
  it('resize to 1920 px on the longest side, JPG at 80, {name}-{width}w, details removed', () => {
    expect(BULK_DEFAULTS).toMatchObject({
      resizeMode: 'longest',
      resizeSize: 1920,
      format: 'jpeg',
      quality: 80,
      rename: '{name}-{width}w',
      metadata: 'strip-all',
      upscale: false,
    });
  });
});

describe('jobOptions', () => {
  it('turns the settings into an image job without enlarging', () => {
    expect(jobOptions(BULK_DEFAULTS)).toEqual({
      resize: { mode: 'longest', value: 1920, upscale: false },
      format: 'jpeg',
      quality: 80,
      targetBytes: undefined,
      metadata: 'strip-all',
      qualityGuard: true,
    });
  });

  it('switches the quality guard off once the user moves the quality slider (D28/D29)', () => {
    const moved = { ...BULK_DEFAULTS, ...withQualityFlag({ quality: 65 }) };
    expect(jobOptions(moved).qualityGuard).toBe(false);
    // Back at 80 by hand: still the user's choice, not inferred from "equals the default".
    const back = { ...moved, ...withQualityFlag({ quality: BULK_DEFAULTS.quality }) };
    expect(jobOptions(back).qualityGuard).toBe(false);
    // Other controls leave the flag alone; Reset brings the guard back.
    expect(withQualityFlag({ resizeSize: 1200 })).toEqual({ resizeSize: 1200 });
    expect(jobOptions(BULK_DEFAULTS).qualityGuard).toBe(true);
    // A changed flag makes earlier results stale.
    expect(settingsSignature(back)).not.toBe(settingsSignature(BULK_DEFAULTS));
  });

  it('never uses a target size (Bulk has quality only)', () => {
    expect(jobOptions({ ...BULK_DEFAULTS, qualityMode: 'target' }).targetBytes).toBeUndefined();
  });

  it('passes Exact size with Fit/Fill and the padding colour', () => {
    const options = jobOptions({
      ...BULK_DEFAULTS,
      resizeMode: 'exact',
      exactWidth: 1080,
      exactHeight: 1350,
      fit: 'fill',
    });
    expect(options.resize).toBeUndefined();
    expect(options.exact).toEqual({
      width: 1080,
      height: 1350,
      fit: 'fill',
      upscale: false,
      padColor: '#ffffff',
    });
  });
});

describe('settingsSignature', () => {
  it('changes with settings that change the output', () => {
    const base = settingsSignature(BULK_DEFAULTS);
    expect(settingsSignature({ ...BULK_DEFAULTS, resizeSize: 800 })).not.toBe(base);
    expect(settingsSignature({ ...BULK_DEFAULTS, format: 'webp' })).not.toBe(base);
    expect(settingsSignature({ ...BULK_DEFAULTS, metadata: 'keep-all' })).not.toBe(base);
  });

  it('ignores the file-name pattern (applied on export)', () => {
    expect(settingsSignature({ ...BULK_DEFAULTS, rename: '{n}' })).toBe(
      settingsSignature(BULK_DEFAULTS),
    );
  });
});

describe('names', () => {
  it('drops only the last extension', () => {
    expect(baseName('photo.final.jpg')).toBe('photo.final');
    expect(baseName('.hidden')).toBe('.hidden');
    expect(baseName('noext')).toBe('noext');
  });

  it('uses jpg for JPEG', () => {
    expect(extensionFor('jpeg')).toBe('jpg');
    expect(extensionFor('webp')).toBe('webp');
  });

  it('plans the output format from "Same as original"', () => {
    expect(plannedFormat('keep', 'a.PNG', 'image')).toBe('png');
    expect(plannedFormat('keep', 'a.heic', 'heic')).toBe('jpeg');
    expect(plannedFormat('keep', 'a.gif', 'image')).toBe('png');
    expect(plannedFormat('webp', 'a.png', 'image')).toBe('webp');
  });

  it('applies the pattern and the output extension', () => {
    expect(
      outputName('{name}-{width}w', {
        name: 'IMG_2041.HEIC',
        width: 1920,
        height: 1440,
        n: 1,
        format: 'jpeg',
      }),
    ).toBe('IMG_2041-1920w.jpg');
    expect(
      outputName('{n}_{name}_{width}x{height}.{format}', {
        name: 'a.png',
        width: 10,
        height: 20,
        n: 7,
        format: 'webp',
      }),
    ).toBe('7_a_10x20.webp.webp');
  });

  it('makes a batch unique, ignoring case', () => {
    const entry = { width: 96, height: 64, format: 'jpeg' as const };
    expect(
      outputNames('{name}-{width}w', [
        { ...entry, name: 'a.jpg', n: 1 },
        { ...entry, name: 'a.png', n: 2 },
        { ...entry, name: 'A.gif', n: 3 },
      ]),
    ).toEqual(['a-96w.jpg', 'a-96w (2).jpg', 'A-96w (3).jpg']);
  });

  it('never gives an empty or unsafe name', () => {
    const [name] = outputNames('../{name}/', [{ name: 'x.jpg', n: 1, format: 'jpeg' }]);
    expect(name).not.toMatch(/[/\\]/);
    expect(name?.endsWith('.jpg')).toBe(true);
  });
});

describe('estimates', () => {
  it('grows with quality and shrinks for WebP and AVIF', () => {
    const size = { width: 1920, height: 1080 };
    expect(estimateBytes(size, 'jpeg', 90)).toBeGreaterThan(estimateBytes(size, 'jpeg', 60));
    expect(estimateBytes(size, 'webp', 80)).toBeLessThan(estimateBytes(size, 'jpeg', 80));
    expect(estimateBytes(size, 'avif', 80)).toBeLessThan(estimateBytes(size, 'webp', 80));
  });

  it('never estimates more than the input scaled by its pixels', () => {
    const source = { width: 2400, height: 1800 };
    const output = { width: 1200, height: 900 };
    expect(estimateFileBytes({ size: 80_000, format: 'jpeg' }, source, output, 'jpeg', 80)).toBe(
      20_000,
    );
  });

  it('uses the typical size for PNG output from a JPEG', () => {
    const size = { width: 100, height: 100 };
    expect(estimateFileBytes({ size: 1_000, format: 'jpeg' }, size, size, 'png', 80)).toBe(
      estimateBytes(size, 'png', 80),
    );
  });
});

describe('formatting', () => {
  it('formats bytes like the prototype', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4300)).toBe('4.2 KB');
    expect(formatBytes(38 * 1024)).toBe('38 KB');
    expect(formatBytes(3.4 * 1024 ** 2)).toBe('3.4 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.50 GB');
  });

  it('says how much time is left', () => {
    expect(formatTimeLeft(null)).toBe('estimating time…');
    expect(formatTimeLeft(0.2)).toBe('about 1 s left');
    expect(formatTimeLeft(40)).toBe('about 40 s left');
    expect(formatTimeLeft(185)).toBe('about 3 min left');
  });
});
