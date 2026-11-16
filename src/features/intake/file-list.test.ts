import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { toast } from '@/ui';
import {
  createFileListStore,
  fileListStore,
  PHONE_WARN_LIMITS,
  resetFileLists,
  useFileList,
} from './file-list';
import { intakeStrings } from './strings';

vi.mock('@/ui', () => ({ toast: vi.fn() }));

let n = 0;
function intake(
  name: string,
  kind: FileKind = 'image',
  opts: { size?: number; lastModified?: number } = {},
): IntakeFile {
  n += 1;
  const file = new File([name], name, { lastModified: opts.lastModified ?? 1000 });
  return { id: `id-${n}`, file, name, size: opts.size ?? file.size, kind };
}

let urls = 0;
let createUrl: MockInstance<typeof URL.createObjectURL>;
let revokeUrl: MockInstance<typeof URL.revokeObjectURL>;
beforeEach(() => {
  urls = 0;
  createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++urls}`);
  revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  resetFileLists();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('file list store', () => {
  it('adds files and makes thumbnail URLs for images only', () => {
    const store = createFileListStore({ isPhone: () => false });
    const added = store
      .getState()
      .add([intake('a.jpg'), intake('b.pdf', 'pdf'), intake('c.heic', 'heic')]);
    expect(added).toHaveLength(3);
    const files = store.getState().files;
    expect(files.map((f) => f.thumbUrl)).toEqual(['blob:test/1', undefined, undefined]);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it('ignores identical files (name, size and date), in the list and in one batch', () => {
    const store = createFileListStore({ isPhone: () => false });
    store.getState().add([intake('a.jpg'), intake('a.jpg')]);
    expect(store.getState().files).toHaveLength(1);
    expect(store.getState().add([intake('a.jpg')])).toEqual([]);
    // Same name, different date or size: a different file.
    store
      .getState()
      .add([
        intake('a.jpg', 'image', { lastModified: 2000 }),
        intake('a.jpg', 'image', { size: 99 }),
      ]);
    expect(store.getState().files).toHaveLength(3);
    // No URL for the duplicates.
    expect(createUrl).toHaveBeenCalledTimes(3);
  });

  it('keeps wrong kinds out with a toast when given accept', () => {
    const store = createFileListStore({ isPhone: () => false });
    store
      .getState()
      .add(
        [
          intake('a.jpg'),
          intake('b.pdf', 'pdf'),
          intake('c.txt', 'unknown'),
          intake('d.cr2', 'raw'),
        ],
        {
          accept: ['image', 'heic'],
        },
      );
    expect(store.getState().files.map((f) => f.name)).toEqual(['a.jpg']);
    expect(toast).toHaveBeenCalledWith('3 files skipped — this tool takes images only');
  });

  it('revokes the URL on remove', () => {
    const store = createFileListStore({ isPhone: () => false });
    const [a, b] = store.getState().add([intake('a.jpg'), intake('b.jpg')]);
    store.getState().remove(a?.id ?? '');
    expect(revokeUrl).toHaveBeenCalledWith('blob:test/1');
    expect(store.getState().files).toEqual([b]);
    store.getState().remove('nope');
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });

  it('revokes every URL on clear', () => {
    const store = createFileListStore({ isPhone: () => false });
    store.getState().add([intake('a.jpg'), intake('b.pdf', 'pdf'), intake('c.png')]);
    store.getState().clear();
    expect(store.getState().files).toEqual([]);
    expect(revokeUrl.mock.calls.map((c) => c[0])).toEqual(['blob:test/1', 'blob:test/2']);
  });

  it('a removed file can be added again', () => {
    const store = createFileListStore({ isPhone: () => false });
    const file = intake('a.jpg');
    store.getState().add([file]);
    store.getState().remove(file.id);
    expect(store.getState().add([{ ...file, thumbUrl: undefined }])).toHaveLength(1);
  });

  it('reorders', () => {
    const store = createFileListStore({ isPhone: () => false });
    store.getState().add(['a', 'b', 'c', 'd'].map((x) => intake(`${x}.pdf`, 'pdf')));
    const order = () =>
      store
        .getState()
        .files.map((f) => f.name[0])
        .join('');
    store.getState().reorder(0, 2);
    expect(order()).toBe('bcad');
    store.getState().reorder(3, 0);
    expect(order()).toBe('dbca');
    store.getState().reorder(1, 9); // out of range: no change
    expect(order()).toBe('dbca');
  });

  it('warns phones once above 500 files', () => {
    const store = createFileListStore({ isPhone: () => true });
    store
      .getState()
      .add(Array.from({ length: PHONE_WARN_LIMITS.files }, (_, i) => intake(`${i}.pdf`, 'pdf')));
    expect(toast).not.toHaveBeenCalled();
    store.getState().add([intake('one-more.pdf', 'pdf')]);
    store.getState().add([intake('and-another.pdf', 'pdf')]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(intakeStrings.phoneSlow, expect.anything());
  });

  it('warns phones above 2 GB in total, but not computers', () => {
    const big = () => intake('huge.dng', 'raw', { size: PHONE_WARN_LIMITS.bytes + 1 });
    createFileListStore({ isPhone: () => false })
      .getState()
      .add([big()]);
    expect(toast).not.toHaveBeenCalled();
    createFileListStore({ isPhone: () => true })
      .getState()
      .add([big()]);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

describe('useFileList', () => {
  it('is one list per tool, shared by every component of that tool', () => {
    const a = renderHook(() => useFileList('compress-image'));
    const b = renderHook(() => useFileList('compress-image', (s) => s.files.length));
    const other = renderHook(() => useFileList('merge-pdf'));
    act(() => {
      a.result.current.add([intake('a.jpg')]);
    });
    expect(a.result.current.files).toHaveLength(1);
    expect(b.result.current).toBe(1);
    expect(other.result.current.files).toHaveLength(0);
    expect(fileListStore('compress-image').getState().files).toHaveLength(1);
  });

  it('resetFileLists revokes and forgets', () => {
    fileListStore('x')
      .getState()
      .add([intake('a.jpg')]);
    resetFileLists();
    expect(revokeUrl).toHaveBeenCalledWith('blob:test/1');
    expect(fileListStore('x').getState().files).toEqual([]);
  });
});
