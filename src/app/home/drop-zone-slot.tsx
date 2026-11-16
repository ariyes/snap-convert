// GOVERNOR: swap for P11 DropZone — <DropZone accept={allKinds} multiple pasteHint onFiles={(items) =>
// onFiles(items.map(({ file, kind }) => ({ file, kind })))} />, then delete this file and guessKind().
//
// Temporary stand-in so the home page works before P11 is merged: same look as the prototype's
// big drop box, with a real (visually hidden) file input, drag and drop, and paste.
import { Upload } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type DragEvent } from 'react';
import { cn } from '@/lib/utils';
import { Kbd, strings } from '@/ui';
import { appStrings } from '../strings';
import { guessKind, type DroppedFile } from './suggest';

const ACCEPT = 'image/*,.heic,.heif,.pdf,.cr2,.cr3,.nef,.arw,.dng,.raf,.orf,.rw2';

const noop = () => () => {};
/** ⌘ on Apple devices, Ctrl elsewhere; "Ctrl" in the pre-rendered HTML. */
function usePasteKey(): string {
  return useSyncExternalStore(
    noop,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}

function toDropped(files: FileList | File[] | null | undefined): DroppedFile[] {
  return Array.from(files ?? []).map((file) => ({ file, kind: guessKind(file) }));
}

export function DropZoneSlot({ onFiles }: { onFiles: (files: DroppedFile[]) => void }) {
  const [over, setOver] = useState(false);
  const pasteKey = usePasteKey();

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = toDropped(event.clipboardData?.files);
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onFiles]);

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    setOver(true);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const files = toDropped(event.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <label
      data-testid="home-drop"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'mt-7 flex cursor-pointer flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-line bg-card px-5 py-9 text-center',
        'transition-[border-color,background-color] duration-150',
        'hover:border-accent hover:bg-[color-mix(in_srgb,var(--accent-soft)_45%,var(--card))]',
        'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent',
        over && 'border-accent bg-[color-mix(in_srgb,var(--accent-soft)_45%,var(--card))]',
      )}
    >
      <span className="grid size-[52px] place-items-center rounded-[14px] bg-accent-soft text-accent">
        <Upload aria-hidden="true" className="size-6" />
      </span>
      <span className="text-lg font-semibold">{appStrings.dropTitle}</span>
      <span className="mt-1 inline-flex h-10 items-center rounded-control border border-accent bg-accent px-4 font-medium text-on-accent">
        {strings.chooseFiles}
      </span>
      <span className="text-ui text-faint">{appStrings.dropFormats}</span>
      <span className="text-ui text-faint">
        {strings.pasteHintPrefix} <Kbd>{pasteKey}</Kbd> + <Kbd>V</Kbd>
      </span>
      <input
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const files = toDropped(event.currentTarget.files);
          event.currentTarget.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}
