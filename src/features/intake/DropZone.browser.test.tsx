// <DropZone> in real Chromium: picker (Playwright file input), synthetic drop, folder drop and paste.
// Stands in for e2e/intake.spec.ts until a route renders a drop zone (P10 / tool pages).
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { toast as sonner } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { fixture } from '@/engines/image/decode/test-utils';
import { Toaster } from '@/ui';
import { DropZone, type DropZoneProps } from './DropZone';
import { resetFileLists, useFileList } from './file-list';
import { resetPasteCount } from './intake';

async function fixtureFile(path: string, name = path.split('/').pop() ?? path): Promise<File> {
  return new File([await fixture(path)], name, { lastModified: 1_700_000_000_000 });
}

function setup(props: Partial<DropZoneProps> = {}) {
  const onFiles = vi.fn<(files: IntakeFile[]) => void>();
  render(
    <>
      <DropZone accept={['image', 'heic']} multiple pasteHint onFiles={onFiles} {...props} />
      <Toaster />
    </>,
  );
  const zone = screen.getByRole('button', { name: /drop images here/i });
  const input = zone.parentElement?.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  return { onFiles, zone, input };
}

/** Files handed to onFiles across all calls. */
const delivered = (fn: ReturnType<typeof vi.fn<(files: IntakeFile[]) => void>>) =>
  fn.mock.calls.flatMap(([files]) => files);

function drop(target: Element, dataTransfer: DataTransfer) {
  act(() => {
    target.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
  expect(target.hasAttribute('data-over')).toBe(true);
  act(() => {
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });
  expect(target.hasAttribute('data-over')).toBe(false);
}

function transfer(files: File[]): DataTransfer {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt;
}

const toastText = (text: string) =>
  waitFor(() => expect(document.body.textContent).toContain(text));

beforeEach(() => resetPasteCount());
afterEach(() => {
  sonner.dismiss();
  cleanup();
  resetFileLists();
  vi.restoreAllMocks();
});

describe('<DropZone>', () => {
  it('has a clear label, the formats and the paste hint', () => {
    const { zone } = setup();
    expect(zone.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('button', { name: 'Drop images here Choose files' })).toBe(zone);
    expect(zone.textContent).toContain('JPG · PNG · WebP · AVIF · GIF · BMP · HEIC — any size');
    // Windows / Linux test machine: Ctrl.
    expect(zone.textContent).toContain('or paste with Ctrl + V');
  });

  it('opens the picker on click, Enter and Space', async () => {
    const { zone, input } = setup();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    await userEvent.click(zone);
    expect(click).toHaveBeenCalledTimes(1);
    zone.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(click).toHaveBeenCalledTimes(3);
    expect(input.accept.split(',')).toContain('image/*');
    expect(input.multiple).toBe(true);
  });

  it('adds picked files, measured and upright', async () => {
    const { onFiles, input } = setup();
    await userEvent.upload(input, [
      await fixtureFile('images/orientation-6.jpg'),
      await fixtureFile('images/iphone-7.heic'),
    ]);
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(delivered(onFiles)).toMatchObject([
      { name: 'orientation-6.jpg', kind: 'image', width: 96, height: 64 },
      { name: 'iphone-7.heic', kind: 'heic', width: 4032, height: 3024 },
    ]);
    // The input is emptied so the same file can be picked again.
    expect(input.value).toBe('');
  });

  it('adds dropped files', async () => {
    const { onFiles, zone } = setup();
    drop(
      zone,
      transfer([
        await fixtureFile('images/sample.webp'),
        await fixtureFile('intake/jpeg-renamed.png'),
      ]),
    );
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(delivered(onFiles)).toMatchObject([
      { name: 'sample.webp', kind: 'image', width: 80, height: 60 },
      { name: 'jpeg-renamed.png', kind: 'image', width: 96, height: 64 },
    ]);
  });

  it('walks dropped folders, skipping hidden files', async () => {
    const { onFiles, zone } = setup();
    const gif = await fixtureFile('images/sample.gif');
    const png = await fixtureFile('images/alpha.png');
    const entry = (file: File, name = file.name) => ({
      name,
      isFile: true,
      isDirectory: false,
      file: (ok: (f: File) => void) => ok(file),
    });
    const folder = (name: string, children: unknown[]) => ({
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => {
        let done = false;
        return {
          readEntries: (ok: (e: unknown[]) => void) => {
            ok(done ? [] : children);
            done = true;
          },
        };
      },
    });
    const tree = folder('Photos', [
      entry(png),
      entry(gif, '.hidden.gif'),
      folder('Nested', [entry(gif)]),
    ]);
    // A real DataTransfer can't hold a folder, so the drop carries a stand-in with one directory entry.
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        types: ['Files'],
        files: [],
        items: [{ kind: 'file', webkitGetAsEntry: () => tree, getAsFile: () => null }],
      },
    });
    act(() => {
      zone.dispatchEvent(event);
    });
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(delivered(onFiles).map((f) => f.name)).toEqual(['alpha.png', 'sample.gif']);
  });

  it('adds pasted screenshots with a dated name', async () => {
    const { onFiles } = setup();
    const shot = new File([await fixture('images/opaque.png')], 'image.png', { type: 'image/png' });
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer([shot]),
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(delivered(onFiles)[0]).toMatchObject({ kind: 'image', width: 90, height: 60 });
    expect(delivered(onFiles)[0]?.name).toMatch(/^pasted-\d{4}-\d{2}-\d{2}-1\.png$/);
    await toastText('Pasted 1 file');
  });

  it('skips files of the wrong kind with a message', async () => {
    const { onFiles, zone } = setup();
    drop(
      zone,
      transfer([
        await fixtureFile('intake/pdf-renamed.jpg'),
        await fixtureFile('intake/text-renamed.jpg'),
        await fixtureFile('intake/sample.cr2'),
        await fixtureFile('images/sample.bmp'),
      ]),
    );
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(delivered(onFiles).map((f) => f.name)).toEqual(['sample.bmp']);
    await toastText('3 files skipped — this tool takes images only');
  });

  it('takes the first file only when not multiple', async () => {
    const onFiles = vi.fn<(files: IntakeFile[]) => void>();
    render(
      <>
        <DropZone accept={['pdf']} onFiles={onFiles} />
        <Toaster />
      </>,
    );
    const zone = screen.getByRole('button', { name: 'Drop a PDF file here Choose a file' });
    drop(
      zone,
      transfer([
        await fixtureFile('intake/sample.pdf', 'a.pdf'),
        await fixtureFile('intake/sample.pdf', 'b.pdf'),
      ]),
    );
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(delivered(onFiles).map((f) => f.name)).toEqual(['a.pdf']);
    await toastText('one file at a time');
  });

  it('sends a paste to one drop zone only: the newest', async () => {
    const first = vi.fn<(files: IntakeFile[]) => void>();
    const second = vi.fn<(files: IntakeFile[]) => void>();
    const accept: FileKind[] = ['image'];
    const { rerender } = render(
      <>
        <DropZone accept={accept} onFiles={first} />
        <DropZone accept={accept} onFiles={second} size="small" />
      </>,
    );
    const shot = new File([await fixture('images/opaque.png')], 'image.png', { type: 'image/png' });
    const paste = () =>
      act(() => {
        document.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer([shot]), cancelable: true }),
        );
      });
    paste();
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();

    rerender(<DropZone accept={accept} onFiles={first} />);
    paste();
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', async () => {
    const { onFiles, zone, input } = setup({ disabled: true });
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    expect(zone.getAttribute('aria-disabled')).toBe('true');
    act(() => zone.click());
    act(() => {
      zone.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer([new File(['x'], 'x.png')]),
        }),
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(click).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
  });
});

describe('<DropZone> with useFileList', () => {
  function Tool() {
    const { files, add } = useFileList('test-tool');
    return (
      <>
        <DropZone accept={['image', 'heic']} multiple onFiles={add} />
        <ul aria-label="files">
          {files.map((f) => (
            <li key={f.id}>
              {f.name} {f.width}×{f.height} {f.thumbUrl ? 'thumb' : 'no-thumb'}
            </li>
          ))}
        </ul>
        <Toaster />
      </>
    );
  }

  const items = () =>
    within(screen.getByRole('list', { name: 'files' })).queryAllByRole('listitem');

  it('lists dropped files once, with thumbnails', async () => {
    render(<Tool />);
    const zone = screen.getByRole('button', { name: /drop images here/i });
    const photo = await fixtureFile('images/orientation-8.jpg');
    drop(zone, transfer([photo]));
    await waitFor(() => expect(items()).toHaveLength(1));
    // The same file again (same name, size and date) is ignored.
    drop(zone, transfer([photo, await fixtureFile('images/sample.gif')]));
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(items().map((li) => li.textContent)).toEqual([
      'orientation-8.jpg 96×64 thumb',
      'sample.gif 40×30 thumb',
    ]);
  });
});
