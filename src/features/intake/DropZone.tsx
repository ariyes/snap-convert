import { Upload } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { cn } from '@/lib/utils';
import { buttonVariants, Kbd, strings, toast } from '@/ui';
import { filesFromDataTransfer } from './folder';
import { acceptAttribute, keepAccepted, toIntakeFiles } from './intake';
import { usePasteTarget } from './paste';
import { isApplePlatform } from './platform';
import { intakeStrings } from './strings';

export interface DropZoneProps {
  /** Kinds this tool takes. Others are skipped with a toast; also filters the picker. */
  accept: readonly FileKind[];
  /** Take several files (default: one). */
  multiple?: boolean;
  /** Called with the accepted files, already detected and measured. */
  onFiles: (files: IntakeFile[]) => void;
  /** Show "or paste with Ctrl + V" (⌘ + V on Apple devices). */
  pasteHint?: boolean;
  /** Listen for paste anywhere on the page while mounted (default true). */
  paste?: boolean;
  /** 'big' for an empty tool page, 'small' for "add more" spots (prototype `.drop-small`). */
  size?: 'big' | 'small';
  title?: string;
  /** Line under the button; defaults to the accepted formats. */
  subtitle?: string;
  disabled?: boolean;
  className?: string;
}

const noSubscribe = () => () => {};

function defaultSubtitle(accept: readonly FileKind[]): string {
  const formats: string[] = [];
  for (const kind of accept) if (kind !== 'unknown') formats.push(intakeStrings.formats[kind]);
  const images = accept.includes('image') || accept.includes('heic');
  return images ? `${formats.join(' · ')} — ${intakeStrings.anySize}` : formats.join(' · ');
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Prototype `.drop`: drag and drop (folders too), click / Enter / Space to pick, paste anywhere.
 * On phones the picker offers the camera roll. Files are checked by their bytes, not their names.
 */
export function DropZone({
  accept,
  multiple = false,
  onFiles,
  pasteHint = false,
  paste = true,
  size = 'big',
  title,
  subtitle,
  disabled = false,
  className,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const apple = useSyncExternalStore(
    noSubscribe,
    () => isApplePlatform(),
    () => false,
  );
  const id = useId();
  const titleId = `${id}-title`;
  const chooseId = `${id}-choose`;
  const subId = `${id}-sub`;
  const hintId = `${id}-hint`;

  // Latest props for async work started by events.
  const latest = useRef({ accept, multiple, onFiles });
  useEffect(() => {
    latest.current = { accept, multiple, onFiles };
  });

  const take = async (raw: File[], pasted = false) => {
    if (raw.length === 0) return;
    setBusy(true);
    try {
      const { accept: kinds, multiple: many, onFiles: deliver } = latest.current;
      let kept = keepAccepted(await toIntakeFiles(raw), kinds);
      if (!many && kept.length > 1) {
        kept = kept.slice(0, 1);
        toast(intakeStrings.onlyOne);
      }
      if (kept.length === 0) return;
      if (pasted) toast(intakeStrings.pasted(kept.length));
      deliver(kept);
    } finally {
      setBusy(false);
    }
  };

  usePasteTarget((files) => void take(files, true), paste && !disabled);

  // A file dropped next to the zone would make the browser open it and leave the page.
  useEffect(() => {
    if (disabled) return;
    const block = (e: globalThis.DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, [disabled]);

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setOver(true);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setOver(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setOver(false);
    if (disabled) return;
    // Entries must be taken during the event; reading them can finish later.
    void filesFromDataTransfer(e.dataTransfer).then((files) => take(files));
  };

  const heading =
    title ?? (multiple ? intakeStrings.dropTitle(accept) : intakeStrings.dropTitleSingle(accept));
  const describedBy = pasteHint ? `${subId} ${hintId}` : subId;

  // The box takes drops; the button inside it is named by exactly its visible text (title +
  // "Choose files", WCAG 2.5.3). The formats line and paste hint sit outside the button as its
  // description, and the button's ::after covers the whole box so a click anywhere opens the
  // picker and the focus ring outlines the box.
  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative flex flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-line bg-card text-center',
        'cursor-pointer transition-[border-color,background-color] duration-150',
        'hover:border-accent hover:bg-[color-mix(in_srgb,var(--accent-soft)_45%,var(--card))]',
        'has-[[data-over]]:border-accent has-[[data-over]]:bg-[color-mix(in_srgb,var(--accent-soft)_45%,var(--card))]',
        size === 'big' ? 'px-5 py-9' : 'px-4 py-6',
        disabled && 'pointer-events-none cursor-not-allowed opacity-45',
        className,
      )}
    >
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${titleId} ${chooseId}`}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        aria-busy={busy || undefined}
        data-over={over || undefined}
        data-size={size}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        className={cn(
          'flex flex-col items-center gap-2.5 focus-visible:outline-none',
          "after:absolute after:-inset-[1.5px] after:rounded-2xl after:content-['']",
          'focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent',
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-[52px] place-items-center rounded-[14px] bg-accent-soft text-accent"
        >
          <Upload className="size-6" />
        </span>
        <span id={titleId} className="text-lg font-semibold">
          {heading}
        </span>{' '}
        <span id={chooseId} className={cn(buttonVariants({ variant: 'primary' }), 'mt-1')}>
          {multiple ? strings.chooseFiles : intakeStrings.chooseFile}
        </span>
      </div>
      <span id={subId} className="text-ui text-faint">
        {subtitle ?? defaultSubtitle(accept)}
      </span>
      {pasteHint && (
        <span id={hintId} className="text-ui text-faint">
          {intakeStrings.pasteHintBefore}{' '}
          {apple ? (
            <Kbd>
              <span aria-hidden="true">{intakeStrings.keyCmd}</span>
              <span className="sr-only">{intakeStrings.keyCmdName}</span>
            </Kbd>
          ) : (
            <Kbd>{intakeStrings.keyCtrl}</Kbd>
          )}{' '}
          {intakeStrings.pasteHintJoin} <Kbd>{intakeStrings.keyV}</Kbd>
        </span>
      )}
      {/* Outside the button: a button role can't hold a live region or another control. */}
      <span role="status" className="sr-only">
        {busy ? intakeStrings.reading : ''}
      </span>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={acceptAttribute(accept)}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          void take(files);
        }}
      />
    </div>
  );
}
