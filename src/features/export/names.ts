import type { NamePatternContext } from '@/core/contracts/export';

/** Used when a name ends up empty after cleaning. */
export const FALLBACK_NAME = 'image';
/**
 * Longest base name we produce, in UTF-16 units as Windows counts them
 * (the extension and any " (2)" come on top).
 */
export const MAX_NAME_CHARS = 150;
/**
 * Longest base name in UTF-8 bytes. Most file systems allow 255 bytes per name; this leaves room
 * for a uniqueness suffix and an extension even when every character is multi-byte.
 */
export const MAX_NAME_BYTES = 200;
/** Longest extension we keep, without the dot. */
const MAX_EXT_CHARS = 10;

/** Path separators and punctuation Windows forbids: / \ : * ? " < > | */
const UNSAFE_PUNCTUATION = new Set([0x2f, 0x5c, 0x3a, 0x2a, 0x3f, 0x22, 0x3c, 0x3e, 0x7c]);

/**
 * Invisible characters that are never allowed in a file name (as code point ranges, so no
 * invisible character ever appears in this source file):
 * - C0 and C1 control characters and DEL
 * - bidirectional controls, which can disguise a name: "photo" + U+202E + "gpj.exe" displays as
 *   "photoexe.jpg"
 * - line/paragraph separators and the byte order mark
 */
const UNSAFE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x009f], // DEL and C1 controls
  [0x061c, 0x061c], // Arabic letter mark
  [0x200e, 0x200f], // left-to-right / right-to-left marks
  [0x202a, 0x202e], // embeddings and overrides
  [0x2066, 0x2069], // isolates
  [0x2028, 0x2029], // line and paragraph separators
  [0xfeff, 0xfeff], // byte order mark
];

function isUnsafeUnit(code: number): boolean {
  return UNSAFE_PUNCTUATION.has(code) || UNSAFE_RANGES.some(([a, b]) => code >= a && code <= b);
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Removes unsafe characters (above) and lone UTF-16 surrogates, which can't be written to disk or
 * encoded as UTF-8. Valid surrogate pairs (emoji and other astral characters) are kept.
 */
export function removeUnsafeChars(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (isHighSurrogate(code)) {
      if (isLowSurrogate(text.charCodeAt(i + 1))) {
        out += text.slice(i, i + 2);
        i += 1;
      }
    } else if (!isLowSurrogate(code) && !isUnsafeUnit(code)) {
      out += text.charAt(i);
    }
  }
  return out;
}

/** Leading/trailing dots and whitespace: hidden files on macOS/Linux, silently dropped on Windows. */
const EDGE_DOTS_AND_SPACES = /^[\s.]+|[\s.]+$/g;

/**
 * Windows device names. A name whose part before the first dot is one of these (any case,
 * any extension, e.g. "con.jpg" or "NUL.tar.gz") can't be created on Windows.
 * Includes COM0/LPT0 and the superscript-digit forms Windows also reserves.
 */
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CONIN$',
  'CONOUT$',
  ...[...'0123456789', String.fromCharCode(0xb9), String.fromCharCode(0xb2), String.fromCharCode(0xb3)].flatMap(
    (d) => [`COM${d}`, `LPT${d}`],
  ),
]);

const TOKEN = /\{(name|width|height|n|format)\}/gi;

const encoder = new TextEncoder();

/** Splits text into user-perceived characters, so truncation never cuts an emoji or accent in half. */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text); // code points: never splits a surrogate pair
}

function truncate(text: string, maxChars: number, maxBytes: number): string {
  if (text.length <= maxChars && encoder.encode(text).length <= maxBytes) return text;
  let out = '';
  let chars = 0;
  let bytes = 0;
  for (const g of graphemes(text)) {
    const gChars = g.length;
    const gBytes = encoder.encode(g).length;
    if (chars + gChars > maxChars || bytes + gBytes > maxBytes) break;
    out += g;
    chars += gChars;
    bytes += gBytes;
  }
  return out;
}

/** "con.jpg" → "con_.jpg"; other names are returned unchanged. */
function avoidReservedWindowsName(name: string): string {
  const dot = name.indexOf('.');
  const stem = (dot === -1 ? name : name.slice(0, dot)).trimEnd();
  if (!RESERVED_WINDOWS_NAMES.has(stem.toUpperCase())) return name;
  return `${stem}_${name.slice(stem.length)}`;
}

/**
 * Makes a base name (no extension) safe to write on Windows, macOS, Linux, Android and iOS:
 * removes unsafe characters, trims dots and spaces, avoids reserved Windows names,
 * limits the length and never returns an empty string.
 */
export function sanitizeBaseName(raw: string, fallback: string = FALLBACK_NAME): string {
  let name = removeUnsafeChars(raw.normalize('NFC')).replace(EDGE_DOTS_AND_SPACES, '');
  name = avoidReservedWindowsName(name);
  name = truncate(name, MAX_NAME_CHARS, MAX_NAME_BYTES).replace(EDGE_DOTS_AND_SPACES, '');
  return name === '' ? fallback : name;
}

/** Splits "photo.final.jpg" into ["photo.final", ".jpg"]. Dot files and "name." have no extension. */
export function splitExtension(fileName: string): [base: string, ext: string] {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return [fileName, ''];
  return [fileName.slice(0, dot), fileName.slice(dot)];
}

/**
 * Makes a full file name (base + extension) safe. Used on every name before it reaches a download,
 * a ZIP entry or a folder, so a bad name from any tool can never escape.
 */
export function safeFileName(fileName: string, fallback: string = FALLBACK_NAME): string {
  const [base, ext] = splitExtension(removeUnsafeChars(fileName.normalize('NFC')).trim());
  const cleanExt = ext
    .slice(1)
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, MAX_EXT_CHARS);
  return sanitizeBaseName(base, fallback) + (cleanExt ? `.${cleanExt}` : '');
}

function tokenValue(token: string, ctx: NamePatternContext): string {
  switch (token.toLowerCase()) {
    case 'name':
      return ctx.name;
    case 'width':
      return ctx.width !== undefined && Number.isFinite(ctx.width)
        ? String(Math.round(ctx.width))
        : '';
    case 'height':
      return ctx.height !== undefined && Number.isFinite(ctx.height)
        ? String(Math.round(ctx.height))
        : '';
    case 'n':
      return Number.isFinite(ctx.n) ? String(Math.round(ctx.n)) : '';
    default:
      return ctx.format;
  }
}

/**
 * Builds a file name from a pattern such as "{name}-{width}x{height}".
 * Tokens: {name} {width} {height} {n} {format} (any letter case). Unknown tokens stay as typed.
 * Values are inserted in one pass, so a "{n}" inside the original name is never expanded.
 * The result is a safe base name; no extension is added (the caller adds it).
 */
export function applyNamePattern(pattern: string, ctx: NamePatternContext): string {
  const expanded = pattern.replace(TOKEN, (_match, token: string) => tokenValue(token, ctx));
  return sanitizeBaseName(expanded);
}

/**
 * Makes names unique, ignoring letter case (Windows and macOS treat "A.jpg" and "a.jpg" as the
 * same file). The first of each name is kept; later ones become "name (2).ext", "name (3).ext" …,
 * skipping any number that is already taken by another name in the list.
 */
export function uniqueNames(names: string[]): string[] {
  const key = (n: string) => n.normalize('NFC').toLowerCase();
  const taken = new Set(names.map(key));
  const seen = new Set<string>();
  const nextNumber = new Map<string, number>();

  return names.map((name) => {
    const k = key(name);
    if (!seen.has(k)) {
      seen.add(k);
      return name;
    }
    const [base, ext] = splitExtension(name);
    let n = nextNumber.get(k) ?? 2;
    let candidate = `${base} (${n})${ext}`;
    while (taken.has(key(candidate))) {
      n += 1;
      candidate = `${base} (${n})${ext}`;
    }
    nextNumber.set(k, n + 1);
    taken.add(key(candidate));
    seen.add(key(candidate));
    return candidate;
  });
}
