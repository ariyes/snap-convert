import { describe, expect, it } from 'vitest';
import { RAW_MEMORY } from '@/engines/raw/plan';
import type { RawFileInfo } from '@/engines/raw/protocol';
import { rawStrings } from '@/engines/raw/strings';
import {
  detailsError,
  formatMegapixels,
  PHONE_HEAVY_MEGAPIXELS,
  phoneAdvice,
  runOutlook,
  thumbSize,
  thumbSource,
  toDetails,
  type RawDetails,
} from './details';

const jpeg = (index: number, width: number, height: number, orientation = 1) => ({
  index,
  width,
  height,
  encoding: 'jpeg',
  orientation,
});

/** File info as the RAW worker gives it (shapes from the CC0 fixtures). */
function info(patch: Partial<RawFileInfo> = {}): RawFileInfo {
  return {
    width: 6000,
    height: 4000,
    orientation: 1,
    previews: [],
    format: 'CR3',
    decoder: 'flashraw',
    embedded: [jpeg(0, 160, 120), jpeg(1, 1620, 1080), jpeg(2, 6000, 4000)],
    hasLocation: false,
    baselineExposure: 0,
    camera: 'Canon EOS M50',
    ...patch,
  };
}

describe('toDetails', () => {
  it('camera, upright size and whether fast mode has a full-size camera JPEG', () => {
    expect(toDetails(info(), 'blob:x')).toEqual({
      status: 'ready',
      camera: 'Canon EOS M50',
      width: 6000,
      height: 4000,
      sensor: { width: 6000, height: 4000 },
      embedded: info().embedded,
      cameraJpeg: true,
      thumbUrl: 'blob:x',
    });
  });

  it('turns portrait files upright (EXIF 6 / 8)', () => {
    const d = toDetails(info({ width: 4928, height: 3264, orientation: 8 }));
    expect([d.width, d.height]).toEqual([3264, 4928]);
    expect(d.sensor).toEqual({ width: 4928, height: 3264 });
  });

  it('a small camera JPEG (Sony 1616 px of 6000) means fast mode develops', () => {
    const sony = info({ embedded: [jpeg(0, 1616, 1080), jpeg(1, 160, 120)] });
    expect(toDetails(sony).cameraJpeg).toBe(false);
    expect(toDetails(info({ embedded: [] })).cameraJpeg).toBe(false);
  });
});

describe('detailsError', () => {
  it('uses the engine’s plain messages', () => {
    expect(detailsError({ kind: 'unsupported', format: 'Sigma X3F' }).message).toBe(
      rawStrings.unsupportedFormat('Sigma X3F'),
    );
    expect(detailsError({ kind: 'unsupported' }).message).toBe(rawStrings.unsupported);
    expect(detailsError({ kind: 'out-of-memory' }).message).toBe(rawStrings.tooLarge);
    expect(detailsError({ kind: 'damaged' }).message).toBe(rawStrings.damaged);
    expect(detailsError(undefined).message).toBe(rawStrings.damaged);
  });
});

describe('thumbnails', () => {
  it('uses the smallest camera JPEG that is big enough', () => {
    expect(thumbSource(info().embedded)?.index).toBe(0);
    // Canon's 160 × 120 thumbnail of a 3:2 photo has black bars: the 3:2 1620 px one is used.
    expect(thumbSource(info().embedded, { width: 6000, height: 4000 })?.index).toBe(1);
    // A 4:3 Olympus: its 160 × 120 thumbnail has the photo's shape.
    expect(
      thumbSource([jpeg(0, 160, 120), jpeg(1, 3200, 2400)], { width: 4608, height: 3456 })?.index,
    ).toBe(0);
    // Nikon: 160 px RGB (not a JPEG), then JPEGs.
    const nikon = [
      { ...jpeg(0, 160, 120), encoding: 'rgb8' },
      jpeg(1, 5568, 3712),
      jpeg(2, 1620, 1080),
      jpeg(3, 640, 424),
    ];
    expect(thumbSource(nikon)?.index).toBe(3);
    expect(thumbSource([jpeg(0, 120, 80), jpeg(1, 100, 66)])?.index).toBe(0);
    expect(thumbSource([{ ...jpeg(0, 6000, 4000), encoding: 'heif' }])).toBeUndefined();
  });

  it('keeps the photo’s shape and never enlarges', () => {
    expect(thumbSize({ width: 6000, height: 4000 })).toEqual({ width: 120, height: 80 });
    expect(thumbSize({ width: 3264, height: 4928 })).toEqual({ width: 79, height: 120 });
    expect(thumbSize({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 });
  });
});

describe('formatMegapixels', () => {
  it('whole numbers from 10 MP, one decimal below', () => {
    expect(formatMegapixels({ width: 6000, height: 4000 })).toBe('24 MP');
    expect(formatMegapixels({ width: 9504, height: 6336 })).toBe('60 MP');
    expect(formatMegapixels({ width: 3008, height: 2000 })).toBe('6.0 MP');
  });
});

describe('run outlook and phone advice', () => {
  const m50 = { details: toDetails(info()), bytes: 15_000_000 };
  const a7r4: { details: RawDetails; bytes: number } = {
    details: toDetails(
      info({
        width: 9504,
        height: 6336,
        camera: 'Sony ILCE-7RM4',
        embedded: [jpeg(0, 1616, 1080), jpeg(1, 160, 120)],
      }),
    ),
    bytes: 62_000_000,
  };

  it('fast mode with camera JPEGs develops nothing', () => {
    const o = runOutlook([m50, m50], 'fast', RAW_MEMORY.phoneBudget);
    expect(o).toEqual({ develops: 0, halfSize: 0, developMegapixels: 0 });
    expect(phoneAdvice(o, true)).toBeNull();
  });

  it('a 61 MP file on a phone: half size, said plainly before the run', () => {
    const o = runOutlook([m50, a7r4], 'fast', RAW_MEMORY.phoneBudget);
    expect(o.develops).toBe(1);
    expect(o.halfSize).toBe(1);
    expect(phoneAdvice(o, true)).toBe('half-size');
    // Same files on a computer: full size, nothing to say.
    const desktop = runOutlook([m50, a7r4], 'fast', RAW_MEMORY.desktopBudget);
    expect(desktop.halfSize).toBe(0);
    expect(phoneAdvice(desktop, false)).toBeNull();
  });

  it('a small output lets big files use a half-size develop for the size, not memory', () => {
    const o = runOutlook([a7r4], 'full', RAW_MEMORY.phoneBudget, () => 1600);
    expect(o.develops).toBe(1);
    // 61 MP at half size fits, but even the half-size plan is "for memory" on a phone.
    expect(o.halfSize).toBe(1);
    const small = runOutlook([m50], 'full', RAW_MEMORY.desktopBudget, () => 1600);
    expect(small.halfSize).toBe(0);
  });

  it('many full develops on a phone: slow, a computer is faster', () => {
    const many = Array.from({ length: 6 }, () => m50);
    const o = runOutlook(many, 'full', RAW_MEMORY.desktopBudget);
    expect(o.developMegapixels).toBeGreaterThan(PHONE_HEAVY_MEGAPIXELS);
    expect(phoneAdvice(o, true)).toBe('slow');
    expect(phoneAdvice(runOutlook([m50], 'full', RAW_MEMORY.desktopBudget), true)).toBeNull();
  });
});
