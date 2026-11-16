import { describe, expect, it } from 'vitest';
import type { FileKind } from '@/core/contracts/intake';
import { countKinds, describeCounts, filesForTool, guessKind, suggestTools } from './suggest';

const file = (name: string, type = '') => new File(['x'], name, { type });
const labels = (kinds: FileKind[]) =>
  suggestTools(countKinds(kinds)).map((s) => `${s.label}${s.soon ? ' (soon)' : ''}`);

describe('guessKind', () => {
  it('sorts files by type and extension', () => {
    expect(guessKind(file('a.jpg', 'image/jpeg'))).toBe('image');
    expect(guessKind(file('a.webp'))).toBe('image');
    expect(guessKind(file('IMG_1.HEIC'))).toBe('heic');
    expect(guessKind(file('doc.pdf', 'application/pdf'))).toBe('pdf');
    expect(guessKind(file('photo.CR3'))).toBe('raw');
    expect(guessKind(file('notes.txt', 'text/plain'))).toBe('unknown');
  });
});

describe('describeCounts', () => {
  it('reads like the prototype', () => {
    expect(describeCounts(countKinds(['image', 'image', 'heic', 'pdf']))).toBe(
      '3 images and 1 PDF',
    );
    expect(describeCounts(countKinds(['image']))).toBe('1 image');
    expect(describeCounts(countKinds(['image', 'pdf', 'pdf', 'raw', 'unknown']))).toBe(
      '1 image, 2 PDFs, 1 RAW photo and 1 other file',
    );
  });
});

describe('suggestTools', () => {
  it('offers the image tools for images, Remove background as coming soon', () => {
    expect(labels(['image', 'image'])).toEqual([
      'Compress',
      'Resize',
      'Convert',
      'Optimize for web',
      'Make a PDF',
      'Remove background (soon)',
    ]);
  });

  it('sends one image to Resize image and several to Bulk resize', () => {
    const resize = (kinds: FileKind[]) =>
      suggestTools(countKinds(kinds)).find((s) => s.label === 'Resize')?.toolId;
    expect(resize(['image'])).toBe('resize-image');
    expect(resize(['image', 'heic'])).toBe('bulk-resize');
  });

  it('offers the PDF tools for PDFs', () => {
    expect(labels(['pdf'])).toEqual(['Merge', 'Split', 'Organize pages', 'Resize pages']);
  });

  it('offers RAW to JPG (coming soon) for RAW photos', () => {
    expect(labels(['raw'])).toEqual(['RAW to JPG (soon)']);
  });

  it('offers nothing for unknown files', () => {
    expect(labels(['unknown'])).toEqual([]);
  });

  it('lists image chips before PDF chips for a mix', () => {
    expect(labels(['pdf', 'image'])).toHaveLength(10);
    expect(labels(['pdf', 'image'])[0]).toBe('Compress');
  });
});

describe('filesForTool', () => {
  it('passes only the files the tool accepts', () => {
    const photo = file('a.jpg');
    const heic = file('b.heic');
    const pdf = file('c.pdf');
    const dropped = [
      { file: photo, kind: 'image' as const },
      { file: heic, kind: 'heic' as const },
      { file: pdf, kind: 'pdf' as const },
    ];
    expect(filesForTool('compress-image', dropped)).toEqual([photo, heic]);
    expect(filesForTool('merge-pdf', dropped)).toEqual([pdf]);
    expect(filesForTool('no-such-tool', dropped)).toEqual([]);
  });
});
