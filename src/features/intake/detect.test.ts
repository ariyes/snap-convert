import { describe, expect, it } from 'vitest';
import type { FileKind } from '@/core/contracts/intake';
import { detectKind, extensionOf, sniffKind } from './detect';
import { fixtureFile } from './test-fixtures';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? ascii(p) : p)));

describe('detectKind on fixtures', () => {
  it.each([
    ['images/orientation-1.jpg', 'image'],
    ['images/no-exif.jpg', 'image'],
    ['images/alpha.png', 'image'],
    ['images/sample.webp', 'image'],
    ['intake/webp-lossy.webp', 'image'],
    ['intake/webp-lossless.webp', 'image'],
    ['intake/webp-alpha.webp', 'image'],
    ['images/sample.avif', 'image'],
    ['images/sample.gif', 'image'],
    ['images/sample.bmp', 'image'],
    ['images/iphone-7.heic', 'heic'],
    ['intake/sample.pdf', 'pdf'],
    ['intake/sample.cr2', 'raw'],
    ['intake/sample.cr3', 'raw'],
    ['intake/sample.nef', 'raw'],
    ['intake/sample.arw', 'raw'],
    ['intake/sample.dng', 'raw'],
    ['intake/sample.raf', 'raw'],
    ['intake/sample.orf', 'raw'],
    ['intake/sample.rw2', 'raw'],
    ['intake/plain.tif', 'unknown'],
  ] as Array<[string, FileKind]>)('%s → %s', async (path, kind) => {
    expect(await detectKind(fixtureFile(path))).toBe(kind);
  });

  it('goes by the bytes, not the name', async () => {
    expect(await detectKind(fixtureFile('intake/jpeg-renamed.png'))).toBe('image');
    expect(await detectKind(fixtureFile('intake/pdf-renamed.jpg'))).toBe('pdf');
    expect(await detectKind(fixtureFile('intake/text-renamed.jpg'))).toBe('unknown');
  });

  it('ignores the MIME type', async () => {
    const text = new File(['just some text'], 'photo.jpg', { type: 'image/jpeg' });
    expect(await detectKind(text)).toBe('unknown');
  });

  it('uses the extension only for TIFF-based RAW', async () => {
    // A plain TIFF renamed .nef counts as RAW (the bytes say TIFF, the name says Nikon) …
    expect(await detectKind(fixtureFile('intake/plain.tif', 'DSC_0001.NEF'))).toBe('raw');
    // … but a text file renamed .nef does not.
    expect(await detectKind(new File(['hello'], 'DSC_0001.nef'))).toBe('unknown');
    // A JPEG named .dng is still a JPEG.
    expect(await detectKind(fixtureFile('images/orientation-1.jpg', 'x.dng'))).toBe('image');
  });

  it('reads plain Blobs (no name) and empty or unreadable files', async () => {
    expect(await detectKind(new Blob([bytes('%PDF-1.7\n')]))).toBe('pdf');
    expect(await detectKind(new Blob([]))).toBe('unknown');
    const broken = new Blob(['x']);
    broken.slice = () => {
      throw new Error('gone');
    };
    expect(await detectKind(broken)).toBe('unknown');
  });

  it('reads only the first bytes', async () => {
    const file = fixtureFile('images/iphone-7.heic');
    const ranges: Array<[number | undefined, number | undefined]> = [];
    const slice = file.slice.bind(file);
    file.slice = (start?: number, end?: number) => {
      ranges.push([start, end]);
      return slice(start, end);
    };
    await detectKind(file);
    expect(ranges).toEqual([[0, 256]]);
  });
});

describe('sniffKind', () => {
  it.each([
    [bytes([0xff, 0xd8, 0xff, 0xdb]), 'image'],
    [bytes('%PDF-1.4'), 'pdf'],
    [bytes([0xef, 0xbb, 0xbf], '%PDF-1.4'), 'pdf'], // after a BOM
    [bytes('FUJIFILMCCD-RAW 0201'), 'raw'],
    [bytes('IIRS', [8, 0, 0, 0]), 'raw'],
    [bytes('MMOR', [0, 0, 0, 8]), 'raw'],
    [bytes([0, 0, 0, 24], 'ftypcrx ', [0, 0, 0, 1]), 'raw'],
    [bytes([0, 0, 0, 24], 'ftypisom', [0, 0, 0, 0], 'isommp41'), 'unknown'], // MP4 video
    [bytes([0, 0, 0, 24], 'ftypmif1', [0, 0, 0, 0], 'mif1heic'), 'heic'],
    [bytes([0, 0, 0, 24], 'ftypmif1', [0, 0, 0, 0], 'mif1avif'), 'image'],
    [bytes([0, 0, 0, 24], 'ftypmsf1', [0, 0, 0, 0], 'msf1hevc'), 'heic'],
    [bytes([0, 0, 0, 20], 'ftypheix', [0, 0, 0, 0], 'heix'), 'heic'],
    [bytes([0, 0, 0, 20], 'ftypavis', [0, 0, 0, 0], 'avis'), 'image'],
    [bytes('PK', [3, 4]), 'unknown'], // a ZIP
    [bytes(''), 'unknown'],
    [bytes([0xff]), 'unknown'],
  ] as Array<[Uint8Array, FileKind]>)('%# → %s', (b, kind) => {
    expect(sniffKind(b)).toBe(kind);
  });

  it('needs "%PDF-" near the start', () => {
    expect(sniffKind(bytes(' '.repeat(40), '%PDF-1.4'))).toBe('unknown');
  });
});

describe('extensionOf', () => {
  it.each([
    ['IMG_1.CR2', 'cr2'],
    ['archive.tar.gz', 'gz'],
    ['.hidden', ''],
    ['noext', ''],
    ['trailing.', ''],
  ])('%s → %s', (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });
});
