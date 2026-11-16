import { describe, expect, it } from 'vitest';
import { QUADRANT_COLOURS, TAG, jpegWithExif, writeExif } from '../../../../tests/fixtures/writers';
import { iccToSrgb } from './color';
import { readContainer } from './container';
import { DecodeError, decodeImage, decodeImageWith, type DecodeLimits } from './index';
import { browserAppliesOrientation } from './orientation';
import { decodeStrings } from './strings';
import { colourDistance, corners, encodeWithCanvas, fixture, pixelAt } from './test-utils';
import type { DecodeWorkerReply } from './testing-worker';

const TOLERANCE = 40; // JPEG/WebP/AVIF compression on solid colour blocks

function decodeInWorker(file: Blob): Promise<DecodeWorkerReply> {
  const worker = new Worker(new URL('./testing-worker.ts', import.meta.url), { type: 'module' });
  return new Promise<DecodeWorkerReply>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<DecodeWorkerReply>) => resolve(e.data);
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage(file);
  }).finally(() => worker.terminate());
}

function expectQuadrants(img: ImageData): void {
  const c = corners(img);
  expect(colourDistance(c.topLeft, QUADRANT_COLOURS.topLeft)).toBeLessThan(TOLERANCE);
  expect(colourDistance(c.topRight, QUADRANT_COLOURS.topRight)).toBeLessThan(TOLERANCE);
  expect(colourDistance(c.bottomLeft, QUADRANT_COLOURS.bottomLeft)).toBeLessThan(TOLERANCE);
  expect(colourDistance(c.bottomRight, QUADRANT_COLOURS.bottomRight)).toBeLessThan(TOLERANCE);
}

describe('decodeImage formats', () => {
  it.each([
    ['orientation-1.jpg', 'jpeg', 96, 64],
    ['opaque.png', 'png', 90, 60],
    ['sample.webp', 'webp', 80, 60],
    ['sample.avif', 'avif', 80, 60],
    ['sample.gif', 'gif', 40, 30],
    ['sample.bmp', 'bmp', 50, 30],
  ] as const)('%s → %s %i×%i, upright test card', async (name, format, width, height) => {
    const img = await decodeImage(await fixture(`images/${name}`));
    expect(img.sourceFormat).toBe(format);
    expect([img.width, img.height]).toEqual([width, height]);
    expect([img.pixels.width, img.pixels.height]).toEqual([width, height]);
    expect(img.hasAlpha).toBe(false);
    expectQuadrants(img.pixels); // GIF: first frame, not the white second frame
  });

  it('detects the format from bytes, not the file name or type', async () => {
    const bytes = await (await fixture('images/sample.webp')).arrayBuffer();
    const img = await decodeImage(new File([bytes], 'photo.jpg', { type: 'image/jpeg' }));
    expect(img.sourceFormat).toBe('webp');
  });

  it('PNG with alpha: hasAlpha true, transparent pixels kept', async () => {
    const img = await decodeImage(await fixture('images/alpha.png'));
    expect([img.width, img.height]).toEqual([90, 60]);
    expect(img.hasAlpha).toBe(true);
    expect(pixelAt(img.pixels, 10, 30)[3]).toBe(0);
    expect(Math.abs(pixelAt(img.pixels, 45, 30)[3] - 128)).toBeLessThan(3);
    expect(pixelAt(img.pixels, 75, 30)).toEqual([255, 64, 0, 255]);
  });

  it('AVIF through the WebAssembly fallback matches', async () => {
    const img = await decodeImageWith(await fixture('images/sample.avif'), undefined, {
      avifDecoder: 'wasm',
    });
    expect(img.sourceFormat).toBe('avif');
    expect([img.width, img.height]).toEqual([80, 60]);
    expectQuadrants(img.pixels);
  });

  it('HEIC (iPhone 7 photo) decodes with libheif to 4032×3024 with metadata', async () => {
    // Decoded in a worker: libheif is slow enough to block this page's main thread.
    const r = await decodeInWorker(await fixture('images/iphone-7.heic'));
    expect(r).toMatchObject({
      ok: true,
      sourceFormat: 'heic',
      width: 4032,
      height: 3024,
      hasAlpha: false,
      camera: 'Apple iPhone 7',
      hasLocation: true,
      takenAt: '2019-03-21T11:04:22',
    });
    expect(r.exifBytes).toBeGreaterThan(100);
    expect(r.iccBytes).toBeGreaterThan(100);
    // Real content, not a blank decode: the photo's corners and centre differ.
    expect(colourDistance(r.topLeft ?? [], r.centre ?? [])).toBeGreaterThan(10);
  }, 30_000);

  it('converts the HEIC Display P3 profile to sRGB', async () => {
    const info = await readContainer(
      new Uint8Array(await (await fixture('images/iphone-7.heic')).arrayBuffer()),
    );
    expect(info.icc).toBeDefined();
    const transform = info.icc ? iccToSrgb(info.icc) : undefined;
    expect(transform).toBeDefined(); // Display P3 is not sRGB, so a conversion is needed
  });
});

describe('EXIF orientation', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('orientation %i comes out upright 96×64', async (o) => {
    const img = await decodeImage(await fixture(`images/orientation-${o}.jpg`));
    expect(img.metadata.orientation).toBe(o);
    expect([img.width, img.height]).toEqual([96, 64]);
    expectQuadrants(img.pixels);
  });

  it('knows whether this browser rotates JPEGs itself', async () => {
    // Chromium applies EXIF orientation in createImageBitmap; the probe must notice.
    expect(await browserAppliesOrientation('jpeg')).toBe(true);
  });
});

describe('metadata', () => {
  it('hasLocation true with GPS, false without', async () => {
    expect((await decodeImage(await fixture('images/gps.jpg'))).metadata.hasLocation).toBe(true);
    expect(
      (await decodeImage(await fixture('images/orientation-1.jpg'))).metadata.hasLocation,
    ).toBe(false);
    expect((await decodeImage(await fixture('images/no-exif.jpg'))).metadata.hasLocation).toBe(
      false,
    );
  });

  it('reads camera, date and the raw EXIF block', async () => {
    const { metadata } = await decodeImage(await fixture('images/orientation-6.jpg'));
    expect(metadata.camera).toBe('Snap Convert Fixture Camera');
    expect(metadata.takenAt).toBe('2024-05-06T07:08:09+02:00');
    const exif = new Uint8Array(metadata.exif ?? new ArrayBuffer(0));
    expect(String.fromCharCode(exif[0] ?? 0, exif[1] ?? 0)).toBe('II');
  });

  it('defaults when there is no EXIF', async () => {
    const { metadata } = await decodeImage(await fixture('images/no-exif.jpg'));
    expect(metadata).toMatchObject({ orientation: 1, hasLocation: false });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.camera).toBeUndefined();
    expect(metadata.takenAt).toBeUndefined();
  });
});

describe('errors', () => {
  it('refuses a file that is not an image', async () => {
    const promise = decodeImage(new Blob(['hello, this is text']));
    await expect(promise).rejects.toBeInstanceOf(DecodeError);
    await expect(promise).rejects.toThrow(decodeStrings.unsupported);
  });

  it('refuses a truncated JPEG with the readable message', async () => {
    const bytes = new Uint8Array(await (await fixture('images/orientation-1.jpg')).arrayBuffer());
    await expect(decodeImage(new Blob([bytes.subarray(0, 40)]))).rejects.toThrow(
      decodeStrings.unsupported,
    );
  });

  it('reports a HEIC libheif cannot read', async () => {
    const heic = new Uint8Array(await (await fixture('images/iphone-7.heic')).arrayBuffer());
    const broken = heic.slice(0, 4000); // container header without image data
    const reply = await decodeInWorker(new Blob([broken]));
    expect(reply).toMatchObject({
      ok: false,
      code: 'heic-unsupported',
      error: decodeStrings.heicUnsupported,
    });
  }, 30_000);

  it('refuses images over 268 megapixels from the header, before decoding', async () => {
    // PNG header claiming 20000 × 20000 with no image data.
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 20000);
    new DataView(png.buffer).setUint32(20, 20000);
    png.set([8, 6, 0, 0, 0], 24);
    const promise = decodeImage(new Blob([png]));
    await expect(promise).rejects.toThrow('This image is too large (400 megapixels)');
    await expect(promise).rejects.toMatchObject({ code: 'too-large' });
  });
});

describe('huge images: reduced decode', () => {
  const limits: DecodeLimits = { maxPixels: 16384 * 16384, reduceAbovePixels: 300_000 }; // pretend 0.3 MP is "huge"

  async function rotatedPhoto(): Promise<Blob> {
    // Upright 800×1200 card, stored as 1200×800 with EXIF orientation 6 (like a phone portrait photo).
    const stored = new OffscreenCanvas(1200, 800);
    const ctx = stored.getContext('2d');
    if (!ctx) throw new Error('no context');
    // Stored pixels rotated 90° anti-clockwise from upright: upright top-left (red) is stored bottom-left.
    const fill = (c: readonly number[], x: number, y: number) => {
      ctx.fillStyle = `rgb(${c.join(',')})`;
      ctx.fillRect(x, y, 600, 400);
    };
    fill(QUADRANT_COLOURS.topLeft, 0, 400);
    fill(QUADRANT_COLOURS.topRight, 0, 0);
    fill(QUADRANT_COLOURS.bottomLeft, 600, 400);
    fill(QUADRANT_COLOURS.bottomRight, 600, 0);
    const jpeg = await encodeWithCanvas(ctx.getImageData(0, 0, 1200, 800), 'image/jpeg', 0.9);
    const exif = writeExif({ ifd0: { [TAG.Orientation]: { type: 'short', value: 6 } } });
    return new Blob([jpegWithExif(jpeg, exif) as Uint8Array<ArrayBuffer>]);
  }

  it('decodes at 2× the final size, upright, and reports the original size', async () => {
    const img = await decodeImageWith(await rotatedPhoto(), { minLongestSide: 200 }, { limits });
    expect(Math.max(img.width, img.height)).toBe(400);
    expect([img.width, img.height]).toEqual([267, 400]);
    expect(img.reducedFrom).toEqual({ width: 800, height: 1200 });
    expectQuadrants(img.pixels);
  });

  it('decodes at full size without a hint, or when the hint is close to the original', async () => {
    const photo = await rotatedPhoto();
    const full = await decodeImageWith(photo, undefined, { limits });
    expect([full.width, full.height, full.reducedFrom]).toEqual([800, 1200, undefined]);
    const near = await decodeImageWith(photo, { minLongestSide: 700 }, { limits });
    expect([near.width, near.height, near.reducedFrom]).toEqual([800, 1200, undefined]);
    expectQuadrants(full.pixels);
  });

  it('refuses when over the pixel limit', async () => {
    const small: DecodeLimits = { maxPixels: 500_000, reduceAbovePixels: 300_000 };
    await expect(
      decodeImageWith(await rotatedPhoto(), undefined, { limits: small }),
    ).rejects.toThrow('This image is too large (1 megapixels)');
  });
});

describe('inside a Web Worker', () => {
  it.each(['orientation-6.jpg', 'orientation-3.jpg', 'sample.avif', 'alpha.png'])(
    'decodes %s without a DOM',
    async (name) => {
      const reply = await decodeInWorker(await fixture(`images/${name}`));
      expect(reply.hasDocument).toBe(false);
      expect(reply.ok).toBe(true);
      if (name.endsWith('.jpg') || name.endsWith('.avif')) {
        expect(colourDistance(reply.topLeft ?? [], QUADRANT_COLOURS.topLeft)).toBeLessThan(
          TOLERANCE,
        );
        expect(colourDistance(reply.bottomRight ?? [], QUADRANT_COLOURS.bottomRight)).toBeLessThan(
          TOLERANCE,
        );
      }
    },
  );

  it('returns readable errors from a worker', async () => {
    const reply = await decodeInWorker(new Blob(['not an image']));
    expect(reply).toMatchObject({ ok: false, error: decodeStrings.unsupported });
  });
});
