// Small sample PDFs for "Try with sample PDFs", written directly as PDF text (a few KB each).
// No library and no asset: the only font is the built-in Helvetica, so nothing is embedded and
// the files work in pdf.js (thumbnails) and pdf-lib (merge/split in the PDF worker) alike.

/** Page size in PDF points (1/72 in). */
export interface SamplePageSize {
  width: number;
  height: number;
}

export interface SamplePdfSpec {
  name: string;
  title: string;
  pages: number;
  size: SamplePageSize;
  /** Header colour, each channel 0–1 (drawn inside the PDF page, not in the UI). */
  tint: readonly [number, number, number];
}

const A4: SamplePageSize = { width: 595.28, height: 841.89 };
const A4_LANDSCAPE: SamplePageSize = { width: 841.89, height: 595.28 };
const A5: SamplePageSize = { width: 419.53, height: 595.28 };
const LETTER: SamplePageSize = { width: 612, height: 792 };

/** The four Merge samples (names and page counts from the approved prototype). */
export const MERGE_SAMPLES: readonly SamplePdfSpec[] = [
  {
    name: 'invoice-march.pdf',
    title: 'Invoice - March',
    pages: 3,
    size: A4,
    tint: [0.78, 0.82, 1],
  },
  {
    name: 'contract-signed.pdf',
    title: 'Contract (signed)',
    pages: 12,
    size: LETTER,
    tint: [0.99, 0.9, 0.54],
  },
  {
    name: 'scanned-receipts.pdf',
    title: 'Scanned receipts',
    pages: 6,
    size: A5,
    tint: [0.73, 0.97, 0.82],
  },
  {
    name: 'brochure-2026.pdf',
    title: 'Brochure 2026',
    pages: 16,
    size: A4_LANDSCAPE,
    tint: [1, 0.79, 0.79],
  },
];

/** The Split sample: ten A4 pages. */
export const SPLIT_SAMPLE: SamplePdfSpec = {
  name: 'sample-report.pdf',
  title: 'Sample report',
  pages: 10,
  size: A4,
  tint: [0.91, 0.84, 1],
};

const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** A PDF literal string: ASCII only, with ( ) \ escaped. */
function pdfText(text: string): string {
  const ascii = text.replace(/[^\x20-\x7e]/g, '?');
  return `(${ascii.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

function pageContent(spec: SamplePdfSpec, page: number): string {
  const { width: w, height: h } = spec.size;
  const [r, g, b] = spec.tint;
  const lines: string[] = [];
  // Header band with the document title.
  lines.push(`${num(r)} ${num(g)} ${num(b)} rg 36 ${num(h - 108)} ${num(w - 72)} 72 re f`);
  lines.push(`BT /F1 22 Tf 0.11 0.1 0.09 rg 56 ${num(h - 80)} Td ${pdfText(spec.title)} Tj ET`);
  // Big page number, so pages are easy to tell apart in thumbnails.
  lines.push(`BT /F1 64 Tf 0.34 0.33 0.31 rg 56 ${num(h / 2)} Td ${pdfText(`Page ${page}`)} Tj ET`);
  lines.push(
    `BT /F1 14 Tf 0.45 0.43 0.41 rg 56 ${num(h / 2 - 32)} Td ${pdfText(`of ${spec.pages}`)} Tj ET`,
  );
  // A few grey "text lines".
  for (let i = 0; i < 6; i++) {
    const y = h / 2 - 90 - i * 22;
    if (y < 48) break;
    const lineWidth = (w - 112) * (i % 3 === 2 ? 0.6 : 1);
    lines.push(`0.9 0.9 0.89 rg 56 ${num(y)} ${num(lineWidth)} 8 re f`);
  }
  return lines.join('\n');
}

/** Builds one sample PDF: `spec.pages` pages of `spec.size`, each showing its page number. */
export function buildSamplePdf(spec: SamplePdfSpec): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  const pageRefs: string[] = [];
  // 1 catalog, 2 page tree, 3 font, 4 info; then a page and its content stream per page.
  const firstPage = 5;
  for (let i = 0; i < spec.pages; i++) pageRefs.push(`${firstPage + i * 2} 0 R`);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${spec.pages} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push(`<< /Title ${pdfText(spec.title)} /Producer (Snap Convert sample) >>`);
  for (let i = 0; i < spec.pages; i++) {
    const content = pageContent(spec, i + 1);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(spec.size.width)} ${num(spec.size.height)}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  // Everything is ASCII, so string length = byte length for the cross-reference offsets.
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** A sample as a File, ready for the file list. */
export function samplePdfFile(spec: SamplePdfSpec): File {
  const bytes = buildSamplePdf(spec);
  // A fixed date keeps "same file added twice" detection stable for repeated clicks.
  return new File([bytes], spec.name, { type: 'application/pdf', lastModified: 0 });
}
