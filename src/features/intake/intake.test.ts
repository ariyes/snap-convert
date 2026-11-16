import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { toast } from '@/ui';
import {
  acceptAttribute,
  keepAccepted,
  namePastedFile,
  partitionByKind,
  resetPasteCount,
  toIntakeFile,
  toIntakeFiles,
} from './intake';
import { intakeStrings, kindWords } from './strings';
import { fixtureFile } from './test-fixtures';

vi.mock('@/ui', () => ({ toast: vi.fn() }));

const fake = (name: string, kind: FileKind, extra: Partial<IntakeFile> = {}): IntakeFile => ({
  id: name,
  file: new File([name], name),
  name,
  size: name.length,
  kind,
  ...extra,
});

afterEach(() => vi.clearAllMocks());

describe('toIntakeFile', () => {
  it('detects the kind and the upright size', async () => {
    const f = await toIntakeFile(fixtureFile('images/orientation-6.jpg'));
    expect(f).toMatchObject({ name: 'orientation-6.jpg', kind: 'image', width: 96, height: 64 });
    expect(f.size).toBe(f.file.size);
    expect(f.id).toBeTruthy();
    expect(f.error).toBeUndefined();
  });

  it('measures HEIC, not PDF or RAW', async () => {
    expect(await toIntakeFile(fixtureFile('images/iphone-7.heic'))).toMatchObject({
      kind: 'heic',
      width: 4032,
      height: 3024,
    });
    const pdf = await toIntakeFile(fixtureFile('intake/pdf-renamed.jpg'));
    expect(pdf.kind).toBe('pdf');
    expect(pdf.width).toBeUndefined();
    const raw = await toIntakeFile(fixtureFile('intake/sample.cr2'));
    expect(raw.kind).toBe('raw');
    expect(raw.width).toBeUndefined();
  });

  it('marks a file that cannot be read', async () => {
    const file = new File(['x'], 'gone.jpg');
    file.slice = () => {
      throw new Error('NotReadableError');
    };
    expect(await toIntakeFile(file)).toMatchObject({
      kind: 'unknown',
      error: intakeStrings.unreadableFile,
    });
  });

  it('gives every file its own id and keeps the order', async () => {
    const files = Array.from({ length: 20 }, (_, i) =>
      i % 2
        ? fixtureFile('images/sample.gif', `${i}.gif`)
        : fixtureFile('intake/sample.pdf', `${i}.pdf`),
    );
    const out = await toIntakeFiles(files);
    expect(out.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(new Set(out.map((f) => f.id)).size).toBe(20);
    expect(out.map((f) => f.kind)).toEqual(files.map((_, i) => (i % 2 ? 'image' : 'pdf')));
  });
});

describe('keepAccepted', () => {
  const mixed = [
    fake('a.jpg', 'image'),
    fake('b.heic', 'heic'),
    fake('c.pdf', 'pdf'),
    fake('d.txt', 'unknown'),
    fake('e.nef', 'raw'),
  ];

  it('keeps the kinds the tool takes and says how many were skipped', () => {
    const kept = keepAccepted(mixed, ['image', 'heic']);
    expect(kept.map((f) => f.name)).toEqual(['a.jpg', 'b.heic']);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('3 files skipped — this tool takes images only');
  });

  it('is quiet when nothing is skipped', () => {
    expect(keepAccepted(mixed.slice(0, 2), ['image', 'heic'])).toHaveLength(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it('reports unreadable files separately', () => {
    const files = [fake('a.pdf', 'pdf'), fake('gone.jpg', 'unknown', { error: 'x' })];
    const parts = partitionByKind(files, ['pdf']);
    expect(parts.kept).toHaveLength(1);
    expect(parts.unreadable).toHaveLength(1);
    expect(parts.wrongKind).toHaveLength(0);
    keepAccepted(files, ['pdf']);
    expect(toast).toHaveBeenCalledWith(intakeStrings.unreadable(1));
  });

  it('names the accepted kinds', () => {
    expect(intakeStrings.skipped(1, ['pdf'])).toBe('1 file skipped — this tool takes PDFs only');
    expect(kindWords(['image', 'heic', 'raw'])).toBe('images and RAW photos');
    expect(kindWords(['image', 'pdf', 'raw'])).toBe('images, PDFs and RAW photos');
  });
});

describe('acceptAttribute', () => {
  it('lets phones offer the camera roll for images', () => {
    const images = acceptAttribute(['image', 'heic']).split(',');
    expect(images).toContain('image/*');
    expect(images).toContain('.heic');
    expect(images).toContain('.heif');
  });

  it('filters PDFs and RAW files', () => {
    expect(acceptAttribute(['pdf'])).toBe('application/pdf,.pdf');
    const raw = acceptAttribute(['raw']).split(',');
    for (const ext of ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2']) {
      expect(raw).toContain(ext);
    }
  });
});

describe('namePastedFile', () => {
  beforeEach(() => resetPasteCount());
  const day = new Date(2026, 10, 16, 9, 30);

  it('names screenshots by date and number', () => {
    const a = namePastedFile(new File(['1'], 'image.png', { type: 'image/png' }), day);
    const b = namePastedFile(new File(['2'], '', { type: 'image/jpeg' }), day);
    expect(a.name).toBe('pasted-2026-11-16-1.png');
    expect(b.name).toBe('pasted-2026-11-16-2.jpg');
    expect(a.type).toBe('image/png');
  });

  it('keeps the name of a copied file', () => {
    const f = new File(['1'], 'holiday.jpg', { type: 'image/jpeg' });
    expect(namePastedFile(f, day)).toBe(f);
  });
});
