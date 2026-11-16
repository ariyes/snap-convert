import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportError } from './errors';
import { canSaveToFolder, saveToFolder } from './folder';

/** In-memory folder that, like Windows and macOS, ignores letter case in names. */
class FakeFolder {
  readonly files = new Map<string, { name: string; text: string }>();
  readonly subfolders = new Set<string>();
  failWrites = false;
  aborted = 0;

  getFileHandle = vi.fn(async (name: string, options?: { create?: boolean }) => {
    await Promise.resolve();
    const key = name.toLowerCase();
    if (this.subfolders.has(key)) throw new DOMException('Is a folder', 'TypeMismatchError');
    if (!this.files.has(key) && !options?.create)
      throw new DOMException('Missing', 'NotFoundError');
    return {
      createWritable: async () => {
        await Promise.resolve();
        let text = '';
        return {
          write: async (blob: Blob) => {
            if (this.failWrites) throw new DOMException('Disk full', 'QuotaExceededError');
            text = await blob.text();
          },
          close: async () => {
            await Promise.resolve();
            this.files.set(key, { name, text });
          },
          abort: async () => {
            await Promise.resolve();
            this.aborted += 1;
          },
        };
      },
    };
  });

  names(): string[] {
    return [...this.files.values()].map((f) => f.name);
  }
}

function installPicker(impl: () => Promise<unknown>) {
  const picker = vi.fn(impl);
  Object.defineProperty(window, 'showDirectoryPicker', { value: picker, configurable: true });
  return picker;
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

const file = (name: string, text = name) => ({ name, blob: new Blob([text]) });

describe('canSaveToFolder', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'showDirectoryPicker');
    Reflect.deleteProperty(window, 'isSecureContext');
    vi.restoreAllMocks();
  });

  it('is false where showDirectoryPicker is missing (Firefox, Safari)', () => {
    expect('showDirectoryPicker' in window).toBe(false);
    expect(canSaveToFolder()).toBe(false);
  });

  it('is true where showDirectoryPicker exists in a secure context', () => {
    setSecureContext(true);
    installPicker(() => Promise.resolve(new FakeFolder()));
    expect(canSaveToFolder()).toBe(true);
  });

  it('is false on an insecure page even if the API exists', () => {
    setSecureContext(false);
    installPicker(() => Promise.resolve(new FakeFolder()));
    expect(canSaveToFolder()).toBe(false);
  });
});

describe('saveToFolder', () => {
  let folder: FakeFolder;

  beforeEach(() => {
    folder = new FakeFolder();
    setSecureContext(true);
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'showDirectoryPicker');
    Reflect.deleteProperty(window, 'isSecureContext');
    vi.restoreAllMocks();
  });

  it('asks for a writable folder and writes every file with a safe, unique name', async () => {
    const picker = installPicker(() => Promise.resolve(folder));
    const result = await saveToFolder([
      file('photo.jpg', 'one'),
      file('PHOTO.jpg', 'two'),
      file('../con.png', 'three'),
      file('a:b*c?.webp', 'four'),
    ]);
    expect(result).toBe('saved');
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ mode: 'readwrite' }));
    expect(folder.names()).toEqual(['photo.jpg', 'PHOTO (2).jpg', 'con_.png', 'abc.webp']);
    expect([...folder.files.values()].map((f) => f.text)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('never overwrites a file that is already in the folder', async () => {
    folder.files.set('photo.jpg', { name: 'photo.jpg', text: 'old' });
    folder.files.set('photo (2).jpg', { name: 'photo (2).jpg', text: 'old 2' });
    folder.subfolders.add('report.pdf');
    installPicker(() => Promise.resolve(folder));

    await saveToFolder([file('Photo.jpg', 'new'), file('report.pdf', 'pdf')]);

    expect(folder.files.get('photo.jpg')?.text).toBe('old');
    expect(folder.files.get('photo (2).jpg')?.text).toBe('old 2');
    expect(folder.files.get('photo (3).jpg')).toEqual({ name: 'Photo (3).jpg', text: 'new' });
    expect(folder.files.get('report (2).pdf')?.text).toBe('pdf');
  });

  it("returns 'cancelled' when the user closes the picker", async () => {
    installPicker(() =>
      Promise.reject(new DOMException('The user aborted a request.', 'AbortError')),
    );
    await expect(saveToFolder([file('a.jpg')])).resolves.toBe('cancelled');
    expect(folder.getFileHandle).not.toHaveBeenCalled();
  });

  it('rejects with save-failed when the picker is refused for another reason', async () => {
    installPicker(() => Promise.reject(new DOMException('Not allowed', 'SecurityError')));
    await expect(saveToFolder([file('a.jpg')])).rejects.toMatchObject({ code: 'save-failed' });
  });

  it('rejects with save-failed and aborts the half-written file when a write fails', async () => {
    folder.failWrites = true;
    installPicker(() => Promise.resolve(folder));
    const result = saveToFolder([file('a.jpg')]);
    await expect(result).rejects.toBeInstanceOf(ExportError);
    await expect(result).rejects.toMatchObject({ code: 'save-failed' });
    expect(folder.aborted).toBe(1);
    expect(folder.files.size).toBe(0);
  });

  it('reports progress from 0 to 1', async () => {
    installPicker(() => Promise.resolve(folder));
    const progress: number[] = [];
    await saveToFolder([file('a.jpg', 'x'.repeat(100)), file('b.jpg', 'y'.repeat(300))], (p) =>
      progress.push(p),
    );
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    progress.slice(1).forEach((p, i) => expect(p).toBeGreaterThanOrEqual(progress[i] ?? 0));
  });

  it('rejects where the API is missing', async () => {
    await expect(saveToFolder([file('a.jpg')])).rejects.toMatchObject({ code: 'save-failed' });
  });
});
