import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFPageLeaf,
  PDFRawStream,
  type PDFDocument,
} from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import type { PdfOutput } from '@/core/contracts';
import {
  drawings,
  fixture,
  open,
  pageTexts,
  runInWorker,
  sizeOf,
  startPdfWorker,
} from './test-utils';

const { api, worker } = startPdfWorker();
afterAll(() => worker.terminate());

const A4: [number, number] = [595.28, 841.89];

/** Every page object stored in the file, including any not in the page tree. */
function storedPageObjects(doc: PDFDocument): number {
  return doc.context.enumerateIndirectObjects().filter(([, obj]) => obj instanceof PDFPageLeaf)
    .length;
}

function rotations(doc: PDFDocument): number[] {
  return doc.getPages().map((p) => p.getRotation().angle);
}

describe('mergePdfs through the PDF worker', () => {
  it('merges 3 fixtures keeping every page, its order, size and rotation', async () => {
    const files = await Promise.all(
      ['a4-3-pages.pdf', 'letter-landscape-2-pages.pdf', 'mixed-4-pages.pdf'].map(fixture),
    );
    const { result, progress } = await runInWorker(api, 'merge', { files, outName: 'all' });
    const [out] = result.files;
    if (!out) throw new Error('no output');
    expect(out.name).toBe('all.pdf');
    expect(out.pages).toBe(3 + 2 + 4);

    const doc = await open(out);
    expect(doc.getPages().map(sizeOf)).toEqual([
      A4,
      A4,
      A4,
      [792, 612],
      [792, 612],
      [419.53, 595.28],
      [612, 1008],
      A4,
      [400, 400],
    ]);
    expect(rotations(doc)).toEqual([0, 0, 0, 0, 0, 0, 0, 90, 0]);
    expect(doc.getPage(8).getCropBox()).toEqual({ x: 50, y: 50, width: 300, height: 300 });
    expect(await pageTexts(out)).toEqual([
      'A4 page 1 of 3',
      'A4 page 2 of 3',
      'A4 page 3 of 3',
      'Letter landscape 1 of 2',
      'Letter landscape 2 of 2',
      'A5 with links',
      'Legal',
      'A4 rotated 90',
      'Cropped',
    ]);
    expect(progress.at(-1)).toBe(1);
  });

  it('keeps web links but drops internal links, without hidden duplicate pages', async () => {
    const files = [await fixture('mixed-4-pages.pdf'), await fixture('a4-3-pages.pdf')];
    const { result } = await runInWorker(api, 'merge', { files, outName: 'x.pdf' });
    const doc = await open(result.files[0] as PdfOutput);
    expect(storedPageObjects(doc)).toBe(7);

    const annots = doc.getPage(0).node.Annots();
    expect(annots?.size()).toBe(1);
    const link = doc.context.lookup(annots?.get(0), PDFDict);
    expect(link.has(PDFName.of('P'))).toBe(false);
    const action = link.lookup(PDFName.of('A'), PDFDict);
    expect(action.get(PDFName.of('S'))).toBe(PDFName.of('URI'));
  });

  it('names the file that is password-protected or damaged', async () => {
    const good = await fixture('a4-3-pages.pdf');
    await expect(
      runInWorker(api, 'merge', { files: [good, await fixture('encrypted.pdf')], outName: 'x' }),
    ).rejects.toThrow('“encrypted.pdf” is password-protected');
    await expect(
      runInWorker(api, 'merge', { files: [await fixture('truncated.pdf'), good], outName: 'x' }),
    ).rejects.toThrow('“truncated.pdf” looks damaged');
  });
});

describe('splitPdf through the PDF worker', () => {
  it('splits "1-3, 5, 8-10" of 10 pages into 3 files with 3, 1 and 3 pages', async () => {
    const file = await fixture('ten-pages.pdf');
    const { result, progress } = await runInWorker(api, 'split', {
      file,
      mode: 'ranges',
      ranges: '1-3, 5, 8-10',
    });
    expect(result.files.map((f) => [f.name, f.pages])).toEqual([
      ['ten-pages-p1-3.pdf', 3],
      ['ten-pages-p5.pdf', 1],
      ['ten-pages-p8-10.pdf', 3],
    ]);
    const texts = await Promise.all(result.files.map(pageTexts));
    expect(texts).toEqual([
      ['Page 1', 'Page 2', 'Page 3'],
      ['Page 5'],
      ['Page 8', 'Page 9', 'Page 10'],
    ]);
    for (const f of result.files) {
      const doc = await open(f);
      expect(
        doc
          .getPages()
          .map(sizeOf)
          .every(([w, h]) => w === A4[0] && h === A4[1]),
      ).toBe(true);
      expect(storedPageObjects(doc)).toBe(f.pages);
    }
    expect(progress.at(-1)).toBe(1);
  });

  it('splits every page and every N pages', async () => {
    const file = await fixture('ten-pages.pdf');
    const every = await runInWorker(api, 'split', { file, mode: 'every-page' });
    expect(every.result.files.map((f) => f.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `ten-pages-p${i + 1}.pdf`),
    );
    const byFour = await runInWorker(api, 'split', { file, mode: 'every-n', n: 4 });
    expect(byFour.result.files.map((f) => [f.name, f.pages])).toEqual([
      ['ten-pages-p1-4.pdf', 4],
      ['ten-pages-p5-8.pdf', 4],
      ['ten-pages-p9-10.pdf', 2],
    ]);
  });

  it('reports bad ranges and settings with the user-facing message', async () => {
    const file = await fixture('ten-pages.pdf');
    await expect(
      runInWorker(api, 'split', { file, mode: 'ranges', ranges: '1-3, 12' }),
    ).rejects.toThrow("Page 12 doesn't exist — this PDF has 10 pages");
    await expect(runInWorker(api, 'split', { file, mode: 'every-n', n: 0 })).rejects.toThrow(
      'Enter how many pages each part should have (1 or more)',
    );
  });
});

describe('organizePdf through the PDF worker', () => {
  it('reorders, rotates (adding to the existing rotation) and deletes pages', async () => {
    const file = await fixture('mixed-4-pages.pdf');
    const { result } = await runInWorker(api, 'organize', {
      file,
      outName: '',
      pages: [
        { index: 2, rotate: 270 }, // already turned 90 → 0
        { index: 0, rotate: 90 },
        { index: 3, rotate: 180 },
        // index 1 (Legal) deleted
      ],
    });
    const [out] = result.files;
    if (!out) throw new Error('no output');
    expect(out.name).toBe('mixed-4-pages.pdf');
    expect(out.pages).toBe(3);
    const doc = await open(out);
    expect(rotations(doc)).toEqual([0, 90, 180]);
    expect(await pageTexts(out)).toEqual(['A4 rotated 90', 'A5 with links', 'Cropped']);
    // The deleted page is really gone from the file.
    expect(storedPageObjects(doc)).toBe(3);
    expect(doc.getPages().map(sizeOf)).toEqual([A4, [419.53, 595.28], [400, 400]]);
  });

  it('rejects pages that do not exist, repeats and empty results', async () => {
    const file = await fixture('ten-pages.pdf');
    const run = (pages: unknown[]) => runInWorker(api, 'organize', { file, outName: 'x', pages });
    await expect(run([{ index: 10, rotate: 0 }])).rejects.toThrow(
      "Page 11 doesn't exist — this PDF has 10 pages",
    );
    await expect(
      run([
        { index: 1, rotate: 0 },
        { index: 1, rotate: 90 },
      ]),
    ).rejects.toThrow('Page 2 is listed twice');
    await expect(run([{ index: 1, rotate: 45 }])).rejects.toThrow(
      'Pages can only be turned by 90, 180 or 270 degrees',
    );
    await expect(run([])).rejects.toThrow('Keep at least one page');
  });
});

describe('resizePages through the PDF worker', () => {
  it('A4 → Letter: uniform scale, centred, text still selectable', async () => {
    const file = await fixture('a4-3-pages.pdf');
    const { result } = await runInWorker(api, 'resize-pages', {
      file,
      pageSize: 'letter',
      orientation: 'auto',
      outName: 'letter',
    });
    const [out] = result.files;
    if (!out) throw new Error('no output');
    expect(out.name).toBe('letter.pdf');
    const doc = await open(out);
    expect(doc.getPages().map(sizeOf)).toEqual([
      [612, 792],
      [612, 792],
      [612, 792],
    ]);

    const scale = Math.min(612 / A4[0], 792 / A4[1]);
    for (const page of doc.getPages()) {
      const [drawing] = drawings(page);
      const [a, b, c, d, e, f] = drawing?.m ?? [];
      expect(a).toBe(d); // x and y scale equal
      expect([b, c]).toEqual([0, 0]);
      expect(a).toBeCloseTo(scale, 4);
      expect(e).toBeCloseTo((612 - A4[0] * scale) / 2, 1); // centred
      expect(f).toBeCloseTo((792 - A4[1] * scale) / 2, 1);
    }
    // Text is still text: pdf.js extracts it from the resized pages.
    expect(await pageTexts(out)).toEqual(['A4 page 1 of 3', 'A4 page 2 of 3', 'A4 page 3 of 3']);
  });

  it('follows each page shape, applies rotation and uses the crop box', async () => {
    const file = await fixture('mixed-4-pages.pdf');
    const { result } = await runInWorker(api, 'resize-pages', {
      file,
      pageSize: 'a4',
      orientation: 'auto',
      outName: 'a4',
    });
    const doc = await open(result.files[0] as PdfOutput);
    // A5 → A4 portrait, Legal → A4 portrait, A4 turned 90 → A4 landscape, 300×300 crop → portrait.
    expect(doc.getPages().map(sizeOf)).toEqual([A4, A4, [841.89, 595.28], A4]);
    expect(rotations(doc)).toEqual([0, 0, 0, 0]);

    const [, , rotated, cropped] = doc.getPages().map((p) => drawings(p)[0]?.m ?? []);
    // The /Rotate 90 page is drawn turned a quarter clockwise at scale 1, filling the page.
    expect(rotated).toEqual([0, -1, 1, 0, 0, 595.28]);
    // The 300×300 crop box is enlarged to the A4 width and centred.
    const s = 595.28 / 300;
    expect(cropped?.[0]).toBeCloseTo(s, 4);
    expect(cropped?.[3]).toBeCloseTo(s, 4);
    expect(cropped?.[5]).toBeCloseTo((841.89 - 300 * s) / 2, 1);

    const lastPage = doc.getPage(3);
    const name = drawings(lastPage)[0]?.name ?? '';
    const xobject = lastPage.node
      .Resources()
      ?.lookup(PDFName.of('XObject'), PDFDict)
      .lookup(PDFName.of(name));
    if (!(xobject instanceof PDFRawStream)) throw new Error('no embedded page');
    const bbox = xobject.dict.lookup(PDFName.of('BBox'), PDFArray).asArray();
    expect(bbox.map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN))).toEqual([
      50, 50, 350, 350,
    ]);

    expect(await pageTexts(result.files[0] as PdfOutput)).toEqual([
      'A5 with links',
      'Legal',
      'A4 rotated 90',
      'Cropped',
    ]);
  });

  it('forced landscape turns every page landscape', async () => {
    const file = await fixture('a4-3-pages.pdf');
    const { result } = await runInWorker(api, 'resize-pages', {
      file,
      pageSize: { width: 400, height: 300 },
      orientation: 'landscape',
      outName: 'x',
    });
    const doc = await open(result.files[0] as PdfOutput);
    expect(doc.getPages().map(sizeOf)).toEqual([
      [400, 300],
      [400, 300],
      [400, 300],
    ]);
  });
});
