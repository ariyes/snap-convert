/**
 * The data files pdf.js may ask for, bundled from `pdfjs-dist` into our own build (no CDN).
 * Each glob only collects URL strings; a file is downloaded (same origin) the first time a PDF needs it.
 * `no-inline` keeps small files as separate assets instead of base64 inside this chunk.
 * Only imported by ./pdfjs.ts, so none of this is in the startup bundle.
 */

/** Predefined Adobe CMaps, needed by CJK text that uses a named encoding (e.g. UniJIS-UCS2-H). */
const cMaps = import.meta.glob<string>('../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

/** Non-embedded standard fonts pdf.js can't map to a system font (Symbol, ZapfDingbats). */
const standardFonts = import.meta.glob<string>(
  '../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}',
  { eager: true, query: '?url&no-inline', import: 'default' },
);

/**
 * Image decoders for JPEG 2000 and JBIG2 scans. The scripting sandbox (quickjs-eval) and the
 * colour-management module (qcms, only used with worker fetching) are deliberately left out.
 */
const wasm = import.meta.glob<string>(
  '../../../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm',
  {
    eager: true,
    query: '?url&no-inline',
    import: 'default',
  },
);

function byFileName(modules: Record<string, string>): Map<string, string> {
  return new Map(
    Object.entries(modules).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
  );
}

const assets: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ['cMapUrl', byFileName(cMaps)],
  ['standardFontDataUrl', byFileName(standardFonts)],
  ['wasmUrl', byFileName(wasm)],
]);

/**
 * URL of a bundled pdf.js data file, or `undefined` when we don't ship it.
 * `kind` and `filename` come from pdf.js (CMap names come from the PDF itself), so only exact
 * matches from the fixed lists above are ever fetched.
 */
export function bundledAssetUrl(kind: string, filename: string): string | undefined {
  return assets.get(kind)?.get(filename);
}

/** Number of bundled files per kind (used by tests). */
export function bundledAssetCounts(): Record<string, number> {
  return Object.fromEntries([...assets].map(([kind, files]) => [kind, files.size]));
}
