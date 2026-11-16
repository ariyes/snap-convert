import { describe, expect, it, vi } from 'vitest';

// If anything reachable from the main-thread entry imported pdf-lib, this factory would throw.
vi.mock('pdf-lib', () => {
  throw new Error('pdf-lib must only be loaded inside the PDF worker');
});

describe('@/engines/pdf main-thread entry', () => {
  it('exports its helpers without loading pdf-lib', async () => {
    const pdf = await import('./index');
    expect(pdf.PDF_OPS).toEqual(['images-to-pdf', 'merge', 'split', 'organize', 'resize-pages']);
    expect(pdf.parseRanges('1-2', 2)).toEqual([[1, 2]]);
    expect(pdf.NAMED_PAGE_SIZES.a4).toEqual({ width: 595.28, height: 841.89 });
  });
});
