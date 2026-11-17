import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildSamplePdf, MERGE_SAMPLES, samplePdfFile, SPLIT_SAMPLE } from './sample-pdfs';

describe('sample PDFs', () => {
  it.each([...MERGE_SAMPLES, SPLIT_SAMPLE])(
    '$name opens with the right pages and size',
    async (spec) => {
      const bytes = buildSamplePdf(spec);
      const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
      expect(doc.getPageCount()).toBe(spec.pages);
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(spec.size.width, 1);
        expect(height).toBeCloseTo(spec.size.height, 1);
      }
      expect(doc.getTitle()).toBe(spec.title);
    },
  );

  it('has a valid cross-reference table', () => {
    const text = new TextDecoder().decode(buildSamplePdf(SPLIT_SAMPLE));
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    // Every offset points at "n 0 obj".
    const entries = text
      .slice(startxref)
      .split('\n')
      .slice(3, 3 + 4 + SPLIT_SAMPLE.pages * 2);
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });

  it('stays small', () => {
    const total = MERGE_SAMPLES.reduce((sum, spec) => sum + buildSamplePdf(spec).length, 0);
    expect(total).toBeLessThan(64 * 1024);
  });

  it('makes PDF files', () => {
    const file = samplePdfFile(MERGE_SAMPLES[0]!);
    expect(file.name).toBe('invoice-march.pdf');
    expect(file.type).toBe('application/pdf');
  });
});
