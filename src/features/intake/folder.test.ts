import { describe, expect, it } from 'vitest';
import { filesFromDataTransfer, filesFromEntry, isHiddenName, type EntryLike } from './folder';

/** Fake File and Directory Entries (what webkitGetAsEntry returns). */
function fileEntry(name: string) {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (ok: (f: File) => void) => ok(new File([name], name)),
  };
}
function dirEntry(name: string, children: EntryLike[], batch = 2) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let at = 0;
      // Like Chrome: several batches, then an empty one.
      return {
        readEntries: (ok: (e: EntryLike[]) => void) => {
          const next = children.slice(at, at + batch);
          at += batch;
          setTimeout(() => ok(next), 0);
        },
      };
    },
  };
}

const names = (files: File[]) => files.map((f) => f.name);

describe('filesFromEntry', () => {
  it('walks folders recursively, in name order, skipping hidden files', async () => {
    const tree = dirEntry('Holiday', [
      fileEntry('photo 10.jpg'),
      fileEntry('.DS_Store'),
      fileEntry('photo 2.jpg'),
      dirEntry('day 1', [fileEntry('a.heic'), fileEntry('._a.heic'), fileEntry('Thumbs.db')]),
      dirEntry('.git', [fileEntry('config')]),
      dirEntry('__MACOSX', [fileEntry('b.jpg')]),
      fileEntry('desktop.ini'),
    ]);
    expect(names(await filesFromEntry(tree))).toEqual(['a.heic', 'photo 2.jpg', 'photo 10.jpg']);
  });

  it('skips files that fail to open', async () => {
    const broken = {
      ...fileEntry('x.jpg'),
      file: (_ok: unknown, fail?: (e: unknown) => void) => fail?.(new Error('x')),
    };
    expect(await filesFromEntry(dirEntry('d', [broken, fileEntry('y.jpg')]))).toHaveLength(1);
  });
});

describe('isHiddenName', () => {
  it.each([
    ['.DS_Store', true],
    ['._IMG_1.JPG', true],
    ['Thumbs.db', true],
    ['IMG_1.JPG', false],
    ['my.photo.jpg', false],
  ])('%s → %s', (name, hidden) => {
    expect(isHiddenName(name)).toBe(hidden);
  });
});

describe('filesFromDataTransfer', () => {
  function transfer(
    items: Array<{ entry: EntryLike | null; file: File | null }>,
    files: File[] = [],
  ) {
    return {
      items: items.map((i) => ({
        kind: 'file',
        webkitGetAsEntry: () => i.entry,
        getAsFile: () => i.file,
      })),
      files,
    } as unknown as DataTransfer;
  }

  it('expands dropped folders and keeps loose files', async () => {
    const dt = transfer([
      { entry: fileEntry('one.png'), file: null },
      { entry: dirEntry('folder', [fileEntry('two.png'), fileEntry('three.pdf')]), file: null },
    ]);
    expect(names(await filesFromDataTransfer(dt))).toEqual(['one.png', 'three.pdf', 'two.png']);
  });

  it('falls back to the plain file when there is no entry', async () => {
    const dt = transfer([{ entry: null, file: new File(['x'], 'x.jpg') }]);
    expect(names(await filesFromDataTransfer(dt))).toEqual(['x.jpg']);
  });

  it('uses dataTransfer.files when there are no items', async () => {
    const dt = {
      items: [],
      files: [new File(['a'], 'a.jpg'), new File(['b'], '.hidden')],
    } as unknown as DataTransfer;
    expect(names(await filesFromDataTransfer(dt))).toEqual(['a.jpg']);
    expect(await filesFromDataTransfer(null)).toEqual([]);
  });
});
