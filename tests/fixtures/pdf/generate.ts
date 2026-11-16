// Generates the PDF test fixtures in this folder. Run from the repo root:
//   node tests/fixtures/pdf/generate.ts
// Output is deterministic (no dates or random IDs), so re-running gives identical files.
//
// Fixtures
//   a4-3-pages.pdf                 3 A4 portrait pages with text
//   letter-landscape-2-pages.pdf   2 Letter landscape pages
//   mixed-4-pages.pdf              A5 (with an internal link, a web link and an /P entry),
//                                  Legal, A4 with /Rotate 90, 400×400 with a 300×300 crop box
//   ten-pages.pdf                  10 A4 pages, "Page 1" … "Page 10"
//   encrypted.pdf                  1 page, password-protected (see below)
//   truncated.pdf                  ten-pages.pdf (without object streams) cut short at a point
//                                  where pdf-lib still "loads" it, but pages are missing
//
// encrypted.pdf: pdf-lib can't encrypt, so this script does it with the PDF standard security
// handler, revision 2 (40-bit RC4, PDF 1.1+ / ISO 32000-1 §7.6.3, algorithms 2–4): every string
// and stream is RC4-encrypted with its per-object key and an /Encrypt dictionary and /ID are
// added to the trailer. Open password "snap", owner password "snap-owner". It is a real
// encrypted PDF: readers ask for the password, and pdf.js opens it with "snap".
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
  degrees,
  type PDFContext,
  type PDFFont,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';

const dir = fileURLToPath(new URL('.', import.meta.url));
const write = (name: string, bytes: Uint8Array) => writeFileSync(`${dir}${name}`, bytes);

const A4: [number, number] = [595.28, 841.89];
const A5: [number, number] = [419.53, 595.28];
const LETTER: [number, number] = [612, 792];
const LEGAL: [number, number] = [612, 1008];

async function newDoc(): Promise<{ doc: PDFDocument; font: PDFFont }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('Snap Convert test fixtures');
  return { doc, font: await doc.embedFont(StandardFonts.Helvetica) };
}

function label(page: PDFPage, font: PDFFont, text: string): void {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 10, y: 10, width: width - 20, height: height - 20, borderWidth: 2 });
  page.drawText(text, { x: 40, y: height - 80, size: 28, font });
}

async function pages(size: [number, number], count: number, text: (n: number) => string) {
  const { doc, font } = await newDoc();
  for (let n = 1; n <= count; n++) label(doc.addPage(size), font, text(n));
  return doc;
}

async function mixed(): Promise<PDFDocument> {
  const { doc, font } = await newDoc();
  const a5 = doc.addPage(A5);
  label(a5, font, 'A5 with links');
  const legal = doc.addPage(LEGAL);
  label(legal, font, 'Legal');
  const rotated = doc.addPage(A4);
  label(rotated, font, 'A4 rotated 90');
  rotated.setRotation(degrees(90));
  const square = doc.addPage([400, 400]);
  label(square, font, 'Cropped');
  square.setCropBox(50, 50, 300, 300);

  const { context } = doc;
  const internal = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [40, 400, 300, 440],
    Border: [0, 0, 0],
    Dest: [legal.ref, 'XYZ', null, null, null],
    P: a5.ref,
  });
  const web = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [40, 300, 300, 340],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/') },
    P: a5.ref,
  });
  a5.node.addAnnot(context.register(internal));
  a5.node.addAnnot(context.register(web));
  return doc;
}

// --- Standard security handler, revision 2 (40-bit RC4) ---

const PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(password: string): Uint8Array {
  const bytes = new TextEncoder().encode(password).subarray(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PADDING.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

function md5(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash('md5');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
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

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

function encryptStrings(obj: PDFObject, key: Uint8Array): PDFObject {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return PDFHexString.of(hex(rc4(key, obj.asBytes())));
  }
  if (obj instanceof PDFDict) {
    for (const [name, value] of obj.entries()) obj.set(name, encryptStrings(value, key));
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) obj.set(i, encryptStrings(obj.get(i), key));
  }
  return obj;
}

async function encrypt(doc: PDFDocument, userPassword: string, ownerPassword: string): Promise<Uint8Array> {
  // Reload without object streams so every object is a plain indirect object we can encrypt.
  const plain = await PDFDocument.load(await doc.save({ useObjectStreams: false }), { updateMetadata: false });
  const context: PDFContext = plain.context;

  const id = md5(new TextEncoder().encode('snap-convert encrypted fixture'));
  const permissions = -4; // everything allowed
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, permissions, true);

  const owner = rc4(md5(padPassword(ownerPassword)).subarray(0, 5), padPassword(userPassword));
  const fileKey = md5(padPassword(userPassword), owner, p, id).subarray(0, 5);
  const user = rc4(fileKey, PADDING);

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const n = ref.objectNumber;
    const g = ref.generationNumber;
    const objectKey = md5(fileKey, Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255)).subarray(0, 10);
    if (obj instanceof PDFRawStream) {
      encryptStrings(obj.dict, objectKey);
      context.assign(ref, PDFRawStream.of(obj.dict, rc4(objectKey, obj.contents)));
    } else {
      context.assign(ref, encryptStrings(obj, objectKey));
    }
  }

  context.trailerInfo.Encrypt = context.register(
    context.obj({
      Filter: 'Standard',
      V: 1,
      R: 2,
      O: PDFHexString.of(hex(owner)),
      U: PDFHexString.of(hex(user)),
      P: permissions,
    }),
  );
  context.trailerInfo.ID = context.obj([PDFHexString.of(hex(id)), PDFHexString.of(hex(id))]);
  return plain.save({ useObjectStreams: false });
}

// --- Write the files ---

write('a4-3-pages.pdf', await (await pages(A4, 3, (n) => `A4 page ${n} of 3`)).save());
write('letter-landscape-2-pages.pdf', await (await pages([LETTER[1], LETTER[0]], 2, (n) => `Letter landscape ${n} of 2`)).save());
write('mixed-4-pages.pdf', await (await mixed()).save());

const ten = await pages(A4, 10, (n) => `Page ${n}`);
write('ten-pages.pdf', await ten.save());

write('truncated.pdf', await truncated(await ten.save({ useObjectStreams: false })));

/**
 * The hard case: cut right after an object (from 30 % of the file on), at the first point where
 * pdf-lib loads the file without an error even though pages are missing.
 */
async function truncated(whole: Uint8Array): Promise<Uint8Array> {
  const text = Buffer.from(whole).toString('latin1');
  for (let end = text.indexOf('endobj', whole.length * 0.3); end !== -1; end = text.indexOf('endobj', end + 1)) {
    const cut = whole.subarray(0, end + 'endobj\n'.length);
    try {
      const doc = await PDFDocument.load(cut, { updateMetadata: false });
      if (doc.getPageCount() < 10) return cut;
    } catch (_) {
      // pdf-lib noticed the damage; try a longer cut
    }
  }
  throw new Error('No truncation point found that pdf-lib loads');
}

write('encrypted.pdf', await encrypt(await pages(A4, 1, () => 'Secret page'), 'snap', 'snap-owner'));
