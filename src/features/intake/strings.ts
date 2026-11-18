import type { FileKind } from '@/core/contracts/intake';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Joins ["images", "PDFs", "RAW photos"] → "images, PDFs and RAW photos". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

/** What each kind is called in messages. HEIC photos count as images. */
const KIND_WORDS: Record<Exclude<FileKind, 'unknown'>, string> = {
  image: 'images',
  heic: 'images',
  pdf: 'PDFs',
  raw: 'RAW photos',
};

/** "images", "PDFs", "images and RAW photos" … for the kinds a tool accepts. */
export function kindWords(accept: readonly FileKind[]): string {
  const words: string[] = [];
  for (const kind of accept) {
    if (kind === 'unknown') continue;
    const word = KIND_WORDS[kind];
    if (!words.includes(word)) words.push(word);
  }
  return words.length > 0 ? joinWords(words) : 'files';
}

/** User-facing strings of the file intake module (M2). Shared text comes from src/ui/strings.ts. */
export const intakeStrings = {
  /** Drop zone title when the tool doesn't pass its own. */
  dropTitle: (accept: readonly FileKind[]) => {
    const onlyPdf = accept.length > 0 && accept.every((k) => k === 'pdf');
    // Camera RAW files are photos too (Convert image and Bulk resize take them, P30).
    const images =
      accept.length > 0 && accept.every((k) => k === 'image' || k === 'heic' || k === 'raw');
    if (onlyPdf) return 'Drop PDF files here';
    if (images) return 'Drop images here';
    return 'Drop files here';
  },
  /** One file only (multiple = false). */
  dropTitleSingle: (accept: readonly FileKind[]) => {
    const onlyPdf = accept.length > 0 && accept.every((k) => k === 'pdf');
    // Camera RAW files are photos too (Convert image and Bulk resize take them, P30).
    const images =
      accept.length > 0 && accept.every((k) => k === 'image' || k === 'heic' || k === 'raw');
    if (onlyPdf) return 'Drop a PDF file here';
    if (images) return 'Drop an image here';
    return 'Drop a file here';
  },
  /** Formats line under the title, per kind. */
  formats: {
    image: 'JPG · PNG · WebP · AVIF · GIF · BMP',
    heic: 'HEIC',
    pdf: 'PDF',
    raw: 'CR2 · CR3 · NEF · ARW · DNG · RAF · ORF · RW2',
  } satisfies Record<Exclude<FileKind, 'unknown'>, string>,
  anySize: 'any size',
  /** Picker button when the tool takes one file (the plural "Choose files" is in src/ui/strings.ts). */
  chooseFile: 'Choose a file',
  /** Paste hint, around the two <Kbd> keys: "or paste with [Ctrl] + [V]". */
  pasteHintBefore: 'or paste with',
  pasteHintJoin: '+',
  keyCtrl: 'Ctrl',
  keyCmd: '⌘',
  keyV: 'V',
  /** Read out instead of the ⌘ symbol. */
  keyCmdName: 'Command',
  pasted: (n: number) => `Pasted ${n} ${plural(n, 'file', 'files')}`,
  skipped: (n: number, accept: readonly FileKind[]) =>
    `${n} ${plural(n, 'file', 'files')} skipped — this tool takes ${kindWords(accept)} only`,
  unreadable: (n: number) =>
    `${n} ${plural(n, 'file', 'files')} couldn't be read. ${plural(n, 'It may have', 'They may have')} been moved or deleted.`,
  /** Shown on an IntakeFile whose bytes couldn't be read. */
  unreadableFile: "This file couldn't be read. It may have been moved or deleted.",
  onlyOne: 'This tool takes one file at a time — the first one was added.',
  phoneSlow: "That's a lot for a phone — it may be slow. Keep this page open while it works.",
  /** Name for a pasted screenshot: pasted-2026-11-16-1.png */
  pastedName: (date: string, n: number, ext: string) => `pasted-${date}-${n}.${ext}`,
  reading: 'Reading files…',
} as const;
