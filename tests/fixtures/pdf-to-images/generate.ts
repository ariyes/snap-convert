// Generates the PDF to images (P31) fixtures in this folder. Run from the repo root:
//   node tests/fixtures/pdf-to-images/generate.ts
// Output is deterministic (no dates or random IDs), so re-running gives identical files.
//
// Fixtures
//   small-text.pdf   1 A4 page: Helvetica, Times and Courier from 5 to 12 pt, 0.25–1 pt rules,
//                    a coloured box, and two filled-in form fields: "PRINTED VALUE" (printable,
//                    as forms usually are) and "SCREEN ONLY" (Print flag off, so it must not
//                    appear on paper or in a saved image).
//   a0-page.pdf      1 A0 portrait page (2383.94 × 3370.39 pt) with a frame and a heading:
//                    300 dpi would be 139 MP, over the 50 MP cap.
//   mixed-pages.pdf  3 pages: A4 portrait, A4 with /Rotate 90 (shown landscape), Letter landscape.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnnotationFlags, PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const dir = fileURLToPath(new URL('.', import.meta.url));
const write = (name: string, bytes: Uint8Array) => writeFileSync(`${dir}${name}`, bytes);

const A4: [number, number] = [595.28, 841.89];
const A0: [number, number] = [2383.94, 3370.39];
const LETTER_LANDSCAPE: [number, number] = [792, 612];

const SENTENCE = 'The quick brown fox jumps over the lazy dog 0123456789';
/** Look-alike characters, added to each line when it still fits on the page. */
const EXTRA = ' - Invoice 4711, EUR 1,234.56, Il1 O0 rn m';

async function newDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('Snap Convert test fixtures');
  return doc;
}

async function smallText(): Promise<PDFDocument> {
  const doc = await newDoc();
  const fonts = {
    Helvetica: await doc.embedFont(StandardFonts.Helvetica),
    Times: await doc.embedFont(StandardFonts.TimesRoman),
    Courier: await doc.embedFont(StandardFonts.Courier),
  };
  const page = doc.addPage(A4);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Small text test page', { x: 40, y: 790, size: 18, font: bold });

  let y = 760;
  for (const [name, font] of Object.entries(fonts)) {
    for (const size of [5, 6, 7, 8, 9, 10, 12]) {
      const line = `${name} ${size} pt: ${SENTENCE}`;
      const text = font.widthOfTextAtSize(line + EXTRA, size) <= 515 ? line + EXTRA : line;
      page.drawText(text, { x: 40, y, size, font });
      y -= size + 6;
    }
    y -= 8;
  }

  // Hairlines and thin rules.
  for (const [i, thickness] of [0.25, 0.5, 1].entries()) {
    page.drawLine({
      start: { x: 40, y: y - i * 10 },
      end: { x: 555, y: y - i * 10 },
      thickness,
      color: rgb(0, 0, 0),
    });
  }
  y -= 40;
  page.drawRectangle({ x: 40, y: y - 60, width: 160, height: 60, color: rgb(0.85, 0.15, 0.1) });
  page.drawText('White on red 8 pt', {
    x: 48,
    y: y - 34,
    size: 8,
    font: fonts.Helvetica,
    color: rgb(1, 1, 1),
  });

  // Two filled-in form fields with appearance streams.
  const form = doc.getForm();
  const printed = form.createTextField('printed');
  printed.setText('PRINTED VALUE');
  printed.addToPage(page, { x: 240, y: y - 60, width: 150, height: 28, font: bold });
  const screen = form.createTextField('screen');
  screen.setText('SCREEN ONLY');
  screen.addToPage(page, { x: 400, y: y - 60, width: 150, height: 28, font: bold });
  for (const widget of screen.acroField.getWidgets()) {
    widget.setFlagTo(AnnotationFlags.Print, false);
  }
  form.updateFieldAppearances(bold);
  return doc;
}

async function a0Page(): Promise<PDFDocument> {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A0);
  page.drawRectangle({
    x: 20,
    y: 20,
    width: A0[0] - 40,
    height: A0[1] - 40,
    borderWidth: 4,
    borderColor: rgb(0, 0, 0),
  });
  page.drawText('A0 poster', { x: 100, y: A0[1] - 200, size: 120, font });
  page.drawText(SENTENCE, { x: 100, y: A0[1] - 300, size: 24, font });
  return doc;
}

async function mixedPages(): Promise<PDFDocument> {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const label = (size: [number, number], text: string) => {
    const page = doc.addPage(size);
    page.drawRectangle({
      x: 10,
      y: 10,
      width: size[0] - 20,
      height: size[1] - 20,
      borderWidth: 2,
    });
    page.drawText(text, { x: 40, y: size[1] - 80, size: 28, font });
    return page;
  };
  label(A4, 'A4 portrait');
  label(A4, 'A4 rotated 90').setRotation(degrees(90));
  label(LETTER_LANDSCAPE, 'Letter landscape');
  return doc;
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: false });

write('small-text.pdf', await save(await smallText()));
write('a0-page.pdf', await save(await a0Page()));
write('mixed-pages.pdf', await save(await mixedPages()));
