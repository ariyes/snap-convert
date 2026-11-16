/** The operations the PDF worker runs (the `op` of a `pdf` job in the queue). */
export const PDF_OPS = ['images-to-pdf', 'merge', 'split', 'organize', 'resize-pages'] as const;
export type PdfOp = (typeof PDF_OPS)[number];
