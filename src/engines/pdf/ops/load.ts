import {
  ParseSpeeds,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPageLeaf,
  PDFRef,
  type PDFObject,
} from 'pdf-lib';
import type { NamedBlob, PdfOutput } from '@/core/contracts';
import { PdfOpError, withTimeout } from './errors';
import { pdfStrings } from './strings';

/** Loading gets 15 s plus 1 s per MB before we give up, so a hostile file can't hang the job. */
export function loadTimeoutMs(bytes: number): number {
  return 15_000 + Math.ceil(bytes / 1_000_000) * 1_000;
}

const APP_NAME = 'Snap Convert';
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Loads a PDF for editing. Throws a `PdfOpError` with a readable message when the file is
 * password-protected, isn't a PDF, is damaged or takes too long. `name` goes into the message
 * when several files are involved (merge), so the user knows which one failed.
 */
export async function loadPdf(
  file: NamedBlob,
  options: { nameInErrors?: boolean } = {},
): Promise<PDFDocument> {
  const name = options.nameInErrors ? file.name : undefined;
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  if (!hasPdfHeader(bytes)) throw new PdfOpError('not-pdf', pdfStrings.notPdf(name));

  let doc: PDFDocument;
  try {
    // ignoreEncryption only lets us look at the file: encrypted files are rejected just below.
    // (pdf-lib's EncryptedPDFError can't be caught by type: it is an ES5 subclass of Error.)
    doc = await withTimeout(
      PDFDocument.load(bytes, {
        ignoreEncryption: true,
        parseSpeed: ParseSpeeds.Fast,
        updateMetadata: false,
      }),
      loadTimeoutMs(bytes.length),
      () => new PdfOpError('timeout', pdfStrings.timeout(name)),
    );
  } catch (error) {
    if (error instanceof PdfOpError) throw error;
    throw new PdfOpError('damaged', pdfStrings.damaged(name));
  }
  // pdf-lib can't decrypt, so even files that open without a password can't be edited.
  if (doc.isEncrypted) throw new PdfOpError('encrypted', pdfStrings.encrypted(name));

  try {
    checkStructure(doc);
  } catch (_) {
    throw new PdfOpError('damaged', pdfStrings.damaged(name));
  }
  if (doc.getPageCount() === 0) throw new PdfOpError('damaged', pdfStrings.noPages(name));
  return doc;
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  // The spec allows junk before the header; readers look in the first 1 KB.
  const end = Math.min(bytes.length, 1024) - PDF_HEADER.length;
  for (let i = 0; i <= end; i++) {
    if (PDF_HEADER.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

/**
 * pdf-lib loads truncated files without complaint and silently skips what's missing. Pages
 * that point to missing objects would come out blank, so treat that as damage.
 */
function checkStructure(doc: PDFDocument): void {
  const { context } = doc;
  const resolve = (obj: PDFObject | undefined): PDFObject | undefined => {
    if (!(obj instanceof PDFRef)) return obj;
    const found = context.lookup(obj);
    if (!found) throw new Error('missing object');
    return found;
  };

  const seen = new Set<PDFObject>();
  const visit = (node: PDFObject | undefined, depth: number) => {
    if (!(node instanceof PDFDict) || seen.has(node) || depth > 64)
      throw new Error('bad page tree');
    seen.add(node);
    if (node instanceof PDFPageLeaf) {
      const contents = resolve(node.get(PDFName.of('Contents')));
      if (contents instanceof PDFArray) contents.asArray().forEach(resolve);
      return;
    }
    const kids = resolve(node.get(PDFName.of('Kids')));
    if (!(kids instanceof PDFArray)) throw new Error('bad page tree');
    for (const kid of kids.asArray()) visit(resolve(kid), depth + 1);
  };
  visit(doc.catalog.Pages(), 0);
}

/** A new, empty PDF that says it was made by Snap Convert (no dates or other details). */
export async function newPdf(): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);
  return doc;
}

/** Keeps the title, author, subject and keywords when one PDF becomes another. */
export function copyDocumentInfo(from: PDFDocument, to: PDFDocument): void {
  const title = from.getTitle();
  const author = from.getAuthor();
  const subject = from.getSubject();
  const keywords = from.getKeywords();
  if (title) to.setTitle(title);
  if (author) to.setAuthor(author);
  if (subject) to.setSubject(subject);
  if (keywords) to.setKeywords([keywords]);
}

/**
 * Prepares pages for copying into another document. pdf-lib copies everything a page refers
 * to, so internal links (to other pages), an annotation's /P (its page) and article beads would
 * drag in hidden duplicate pages. Those are removed; web links and other annotations stay.
 * The outline (bookmarks) lives in the document catalog, which isn't copied.
 */
export function prepareForCopy(doc: PDFDocument): void {
  const { context } = doc;
  for (const page of doc.getPages()) {
    const node = page.node;
    node.delete(PDFName.of('B'));
    node.delete(PDFName.of('AA'));
    const annots = node.Annots();
    if (!annots) continue;
    const kept = annots.asArray().filter((ref) => {
      const annot = context.lookup(ref);
      if (!(annot instanceof PDFDict)) return false;
      if (annot.get(PDFName.of('Subtype')) === PDFName.of('Link') && !isWebLink(annot, doc))
        return false;
      annot.delete(PDFName.of('P'));
      return true;
    });
    if (kept.length > 0) node.set(PDFName.of('Annots'), context.obj(kept));
    else node.delete(PDFName.of('Annots'));
  }
}

function isWebLink(link: PDFDict, doc: PDFDocument): boolean {
  if (link.has(PDFName.of('Dest'))) return false;
  const action = doc.context.lookup(link.get(PDFName.of('A')));
  return action instanceof PDFDict && action.get(PDFName.of('S')) === PDFName.of('URI');
}

/** Removes everything but the drawing (content and resources) before a page is embedded. */
export function prepareForEmbed(doc: PDFDocument): void {
  for (const page of doc.getPages()) {
    for (const key of ['Annots', 'B', 'AA', 'Thumb']) page.node.delete(PDFName.of(key));
  }
}

export async function savePdf(doc: PDFDocument, name: string): Promise<PdfOutput> {
  const bytes = await doc.save({ useObjectStreams: true });
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    name,
    pages: doc.getPageCount(),
  };
}

/** "report.PDF" → "report". */
export function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '') || 'document';
}

/** Makes sure an output name ends in .pdf; falls back to `fallback` when empty. */
export function pdfName(name: string, fallback: string): string {
  const trimmed = name.trim() || fallback;
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
}
