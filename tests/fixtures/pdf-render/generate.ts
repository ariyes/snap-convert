/**
 * Generates the small PDF fixtures used by the P08 render tests (src/engines/pdf/render/).
 * Run from the repo root: `node tests/fixtures/pdf-render/generate.ts`
 *
 * - mixed-sizes.pdf          5 pages: A4, Letter landscape, 200×100, A5 with /Rotate 90, CropBox page
 * - text-fonts.pdf           1 page with non-embedded Helvetica and ZapfDingbats text
 * - cjk-cmap.pdf             1 page using a predefined Adobe CMap (UniJIS-UCS2-H), non-embedded CID font
 * - encrypted-user.pdf       RC4 40-bit (R2) encrypted, user password "secret" required to open
 * - encrypted-owner.pdf      RC4 40-bit (R2) encrypted, empty user password (opens without a prompt)
 *
 * pdf-lib cannot write encrypted or CID-keyed files, so those three are written by hand below.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PDFDocument, PageSizes, StandardFonts, degrees, rgb } from 'pdf-lib';

const outDir = new URL('./', import.meta.url);

function save(name: string, bytes: Uint8Array): void {
  writeFileSync(new URL(name, outDir), bytes);
}

// ---------------------------------------------------------------- pdf-lib fixtures

async function mixedSizes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const fill = (page: ReturnType<typeof doc.addPage>, r: number, g: number, b: number) => {
    const { x, y, width, height } = page.getMediaBox();
    page.drawRectangle({ x, y, width, height, color: rgb(r, g, b) });
  };

  fill(doc.addPage(PageSizes.A4), 1, 0, 0); // 595.28 × 841.89, red
  fill(doc.addPage([792, 612]), 0, 1, 0); // Letter landscape, green
  fill(doc.addPage([200, 100]), 0, 0, 1); // tiny, blue

  const rotated = doc.addPage(PageSizes.A5); // 419.53 × 595.28, shown as 595.28 × 419.53
  fill(rotated, 1, 1, 0);
  rotated.setRotation(degrees(90));

  const cropped = doc.addPage([600, 800]);
  fill(cropped, 1, 0, 1);
  cropped.setCropBox(50, 50, 500, 700); // visible area 500 × 700

  return doc.save({ useObjectStreams: false });
}

async function textFonts(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const page = doc.addPage(PageSizes.A4);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const dingbats = await doc.embedFont(StandardFonts.ZapfDingbats);
  page.drawText('Snap Convert thumbnail test', { x: 50, y: 760, size: 32, font: helvetica });
  page.drawText('✂✈✉', { x: 50, y: 700, size: 32, font: dingbats });
  page.drawRectangle({ x: 50, y: 100, width: 495, height: 500, color: rgb(0, 0, 0) });
  return doc.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------- hand-written files

type PdfObject = string | Uint8Array;

/** Serialises numbered objects (1-based) into a PDF with a classic xref table. */
function writePdf(objects: PdfObject[], trailer: string): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : Buffer.from(body),
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} ${trailer} >>`,
    'startxref',
    String(length),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

function stream(dict: string, data: Uint8Array): Uint8Array {
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'),
    Buffer.from(data),
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

function cjkCmap(): Uint8Array {
  // "日本語" in UCS-2 big-endian, shown with the predefined UniJIS-UCS2-H CMap.
  const content = Buffer.from(
    'BT /F1 48 Tf 50 300 Td <65E5672C8A9E> Tj ET\n0 0 0 rg 50 50 300 100 re f\n',
    'latin1',
  );
  return writePdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      stream('', content),
      '<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
      '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 7 0 R /DW 1000 >>',
      '<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 6 /FontBBox [-437 -340 1147 1317] /ItalicAngle 0 /Ascent 1317 /Descent -349 /CapHeight 742 /StemV 80 >>',
    ],
    '/Root 1 0 R',
  );
}

// Standard security handler, revision 2 (RC4, 40-bit key) — PDF 1.7 spec §7.6.3, algorithms 2–5.
const PASSWORD_PAD = Buffer.from(
  '28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A',
  'hex',
);

function padPassword(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PAD]).subarray(0, 32);
}

function md5(...chunks: Uint8Array[]): Buffer {
  const hash = createHash('md5');
  for (const c of chunks) hash.update(c);
  return hash.digest();
}

function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

function encrypted(userPassword: string, ownerPassword: string, permissions: number): Uint8Array {
  const id = md5(Buffer.from(`snap-convert-${userPassword}-${ownerPassword}`, 'latin1'));
  const o = rc4(md5(padPassword(ownerPassword)).subarray(0, 5), padPassword(userPassword));
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const fileKey = md5(padPassword(userPassword), o, p, id).subarray(0, 5);
  const u = rc4(fileKey, PASSWORD_PAD);
  const objectKey = (num: number) =>
    md5(fileKey, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(
      0,
      10,
    );

  // Full-page blue fill; the stream (object 4) is RC4-encrypted with its object key.
  const content = Buffer.from('0 0 1 rg 0 0 300 400 re f\n', 'latin1');
  return writePdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 4 0 R >>',
      stream('', rc4(objectKey(4), content)),
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${o.toString('hex')}> /U <${u.toString('hex')}> /P ${permissions} >>`,
    ],
    `/Root 1 0 R /Encrypt 5 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>]`,
  );
}

save('mixed-sizes.pdf', await mixedSizes());
save('text-fonts.pdf', await textFonts());
save('cjk-cmap.pdf', cjkCmap());
// All permissions (-4); opening needs the user password.
save('encrypted-user.pdf', encrypted('secret', 'owner-secret', -4));
// Print/modify/copy/annotate denied (-64); empty user password, so it opens without a prompt.
save('encrypted-owner.pdf', encrypted('', 'owner-secret', -64));
