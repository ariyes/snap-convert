import { PDFDict, PDFName, PDFRawStream, type PDFPage } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import type { ImagesToPdfInput, NamedBlob } from '@/core/contracts';
import { withExifOrientation } from './exif-test-data';
import {
  blobOf,
  drawings,
  makeImage,
  open,
  runInWorker,
  sizeOf,
  startPdfWorker,
} from './test-utils';

const { api, worker } = startPdfWorker();
afterAll(() => worker.terminate());

const MARGIN_10MM = (10 * 72) / 25.4;

function input(images: NamedBlob[], patch: Partial<ImagesToPdfInput> = {}): ImagesToPdfInput {
  return { images, pageSize: 'a4', orientation: 'auto', marginMm: 10, outName: 'photos', ...patch };
}

async function build(images: NamedBlob[], patch: Partial<ImagesToPdfInput> = {}) {
  const { result, progress } = await runInWorker(api, 'images-to-pdf', input(images, patch));
  const file = result.files[0];
  if (!file) throw new Error('no output');
  return { file, doc: await open(file), progress };
}

/** The one image drawn on the page: its matrix and the raw bytes stored in the PDF. */
function imageOn(page: PDFPage) {
  const [drawing] = drawings(page);
  if (!drawing) throw new Error('no image drawn');
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  const stream = xobjects?.lookup(PDFName.of(drawing.name));
  if (!(stream instanceof PDFRawStream)) throw new Error('image not found');
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = drawing.m;
  return { m: { a, b, c, d, e, f }, stream };
}

describe('imagesToPdf through the PDF worker', () => {
  it('portrait photo on A4 auto → portrait page, image fitted inside the margins', async () => {
    const jpeg = await makeImage(600, 900, 'image/jpeg');
    const { file, doc } = await build([blobOf(jpeg, 'portrait.jpg')]);
    expect(file.name).toBe('photos.pdf');
    expect(file.pages).toBe(1);

    const page = doc.getPage(0);
    expect(sizeOf(page)).toEqual([595.28, 841.89]);
    const { m } = imageOn(page);
    expect(m.b).toBe(0);
    expect(m.c).toBe(0);
    expect(m.a / m.d).toBeCloseTo(600 / 900, 3); // drawn with the image's own ratio
    expect(m.d).toBeCloseTo(841.89 - 2 * MARGIN_10MM, 1); // fills the height inside the margins
    expect(m.e).toBeCloseTo((595.28 - m.a) / 2, 1); // centred
    expect(m.f).toBeCloseTo(MARGIN_10MM, 1);
    expect(m.e).toBeGreaterThanOrEqual(MARGIN_10MM - 0.01);
  });

  it('landscape photo → landscape page', async () => {
    const jpeg = await makeImage(900, 600, 'image/jpeg');
    const { doc } = await build([blobOf(jpeg, 'landscape.jpg')]);
    const page = doc.getPage(0);
    expect(sizeOf(page)).toEqual([841.89, 595.28]);
    const { m } = imageOn(page);
    expect(m.a / m.d).toBeCloseTo(900 / 600, 3);
    expect(m.a).toBeCloseTo(841.89 - 2 * MARGIN_10MM, 1); // wide: fills the width
  });

  it('forced portrait keeps a landscape photo whole, fitted to the width', async () => {
    const jpeg = await makeImage(900, 600, 'image/jpeg');
    const { doc } = await build([blobOf(jpeg, 'landscape.jpg')], { orientation: 'portrait' });
    const page = doc.getPage(0);
    expect(sizeOf(page)).toEqual([595.28, 841.89]);
    const { m } = imageOn(page);
    expect(m.a).toBeCloseTo(595.28 - 2 * MARGIN_10MM, 1);
    expect(m.a / m.d).toBeCloseTo(1.5, 3);
    expect(m.f).toBeCloseTo((841.89 - m.d) / 2, 1);
  });

  it('fit-image: page equals the image size and ratio (1 px = 1 pt)', async () => {
    const jpeg = await makeImage(1200, 800, 'image/jpeg');
    const { doc } = await build([blobOf(jpeg, 'a.jpg')], { pageSize: 'fit-image', marginMm: 0 });
    const page = doc.getPage(0);
    expect(sizeOf(page)).toEqual([1200, 800]);
    expect(imageOn(page).m).toMatchObject({ a: 1200, d: 800, e: 0, f: 0 });
  });

  it('fit-image with a margin adds the margin around the image', async () => {
    const jpeg = await makeImage(400, 300, 'image/jpeg');
    const { doc } = await build([blobOf(jpeg, 'a.jpg')], { pageSize: 'fit-image', marginMm: 10 });
    const page = doc.getPage(0);
    const [w, h] = sizeOf(page);
    expect(w).toBeCloseTo(400 + 2 * MARGIN_10MM, 1);
    expect(h).toBeCloseTo(300 + 2 * MARGIN_10MM, 1);
    const { m } = imageOn(page);
    expect([m.a, m.d]).toEqual([400, 300]);
    expect(m.e).toBeCloseTo(MARGIN_10MM, 1);
  });

  it('fit-image caps the page at 200 inches, keeping the ratio', async () => {
    const png = await makeImage(20000, 200, 'image/png');
    const { doc } = await build([blobOf(png, 'wide.png')], { pageSize: 'fit-image', marginMm: 0 });
    const [w, h] = sizeOf(doc.getPage(0));
    expect(w).toBe(14400);
    expect(w / h).toBeCloseTo(20000 / 200, 1);
  });

  it('embeds JPEG bytes unchanged (no recompression)', async () => {
    const jpeg = await makeImage(640, 480, 'image/jpeg');
    const { doc } = await build([blobOf(jpeg, 'a.jpg')]);
    const { stream } = imageOn(doc.getPage(0));
    expect(stream.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(stream.contents).toEqual(jpeg);
  });

  it('applies EXIF orientation 6 (phone portrait) without touching the JPEG bytes', async () => {
    // Stored sideways (900×600) with "turn 90° clockwise" in EXIF: shows as 600×900 portrait.
    const jpeg = withExifOrientation(await makeImage(900, 600, 'image/jpeg'), 6);
    const { doc } = await build([blobOf(jpeg, 'phone.jpg')]);
    const page = doc.getPage(0);
    expect(sizeOf(page)).toEqual([595.28, 841.89]);
    const { m, stream } = imageOn(page);
    expect(stream.contents).toEqual(jpeg);
    // Quarter turn: [0 -h w 0 x y+h] with w:h = 600:900.
    expect(m.a).toBe(0);
    expect(m.d).toBe(0);
    expect(m.c / -m.b).toBeCloseTo(600 / 900, 3);
    expect(-m.b).toBeCloseTo(841.89 - 2 * MARGIN_10MM, 1);
  });

  it('embeds PNG with transparency and keeps the order of several images', async () => {
    const images = [
      blobOf(await makeImage(300, 200, 'image/png'), 'one.png'),
      blobOf(await makeImage(200, 300, 'image/jpeg'), 'two.jpg'),
      blobOf(await makeImage(250, 250, 'image/png'), 'three.png'),
    ];
    const { file, doc, progress } = await build(images, { pageSize: 'letter' });
    expect(file.pages).toBe(3);
    expect(doc.getPages().map(sizeOf)).toEqual([
      [792, 612],
      [612, 792],
      [612, 792],
    ]);
    const ratios = doc
      .getPages()
      .map((p) => imageOn(p).m)
      .map((m) => m.a / m.d);
    expect(ratios[0]).toBeCloseTo(1.5, 3);
    expect(ratios[1]).toBeCloseTo(2 / 3, 3);
    expect(ratios[2]).toBeCloseTo(1, 3);
    expect(imageOn(doc.getPage(0)).stream.dict.has(PDFName.of('SMask'))).toBe(true);
    // Progress per page, increasing, ending at 1.
    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(progress).toEqual([...progress].sort((x, y) => x - y));
    expect(progress.at(-1)).toBe(1);
  });

  it('custom page sizes follow the orientation too', async () => {
    const jpeg = await makeImage(600, 900, 'image/jpeg');
    const { doc } = await build([blobOf(jpeg, 'a.jpg')], {
      pageSize: { width: 500, height: 300 },
      marginMm: 0,
    });
    expect(sizeOf(doc.getPage(0))).toEqual([300, 500]);
  });

  it('rejects images a PDF cannot hold, and impossible margins, with readable messages', async () => {
    const webp = blobOf(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '), 'photo.webp');
    await expect(runInWorker(api, 'images-to-pdf', input([webp]))).rejects.toThrow(
      "“photo.webp” can't go into a PDF as it is — only JPEG and PNG images can be added",
    );
    const brokenJpeg = blobOf(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), 'broken.jpg');
    await expect(runInWorker(api, 'images-to-pdf', input([brokenJpeg]))).rejects.toThrow(
      "“broken.jpg” couldn't be read — the image may be damaged",
    );
    const jpeg = blobOf(await makeImage(10, 10, 'image/jpeg'), 'a.jpg');
    await expect(
      runInWorker(api, 'images-to-pdf', input([jpeg], { marginMm: 120 })),
    ).rejects.toThrow('The margin is too large for this page size');
    await expect(runInWorker(api, 'images-to-pdf', input([]))).rejects.toThrow(
      'Add at least one image',
    );
  });
});
