import { ArrowLeft, ArrowRight, CircleAlert, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { IntakeFile } from '@/core/contracts/intake';
import { cn } from '@/lib/utils';
import { Button, Card, IconButton } from '@/ui';
import { formatBytes } from './format';
import type { PageOptions } from './page-layout';
import { PagePreview } from './page-preview';
import { strings } from './strings';

/** Drag data type for moving a card (never confused with files dropped from the computer). */
const DRAG_TYPE = 'application/x-snap-convert-page';

export interface PageGridProps {
  files: readonly IntakeFile[];
  options: PageOptions;
  /** Preview URLs for files the browser can't show itself (HEIC), by file id. */
  previews: Readonly<Record<string, string>>;
  /** Files whose preview is being made. */
  previewBusy: ReadonlySet<string>;
  /** Problems per file id, shown on the card. */
  errors: Readonly<Record<string, string>>;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  /** The "add more" drop zone, shown as the last tile. */
  addTile: ReactNode;
  disabled?: boolean;
}

type FocusTarget = { id: string; which: 'earlier' | 'later' };

/**
 * The pages as a card grid (prototype Merge PDF pattern): order badges, drag to reorder, and
 * move earlier / later buttons for keyboard and touch. Every move is announced.
 */
export function PageGrid({
  files,
  options,
  previews,
  previewBusy,
  errors,
  onMove,
  onRemove,
  onClear,
  addTile,
  disabled = false,
}: PageGridProps) {
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<FocusTarget | null>(null);

  const total = files.reduce((n, f) => n + f.size, 0);

  // After a move, keep focus on the moved card's button (or its other move button at either end).
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const first = buttons.current.get(`${want.id}:${want.which}`);
    const other = buttons.current.get(
      `${want.id}:${want.which === 'earlier' ? 'later' : 'earlier'}`,
    );
    const el = first && !first.disabled ? first : other;
    el?.focus();
  }, [files]);

  const move = (from: number, to: number, focus?: FocusTarget) => {
    const file = files[from];
    if (!file || to < 0 || to >= files.length || from === to) return;
    pendingFocus.current = focus ?? null;
    onMove(from, to);
    setAnnouncement(strings.moved(file.name, to + 1, files.length));
  };

  const ref = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(key, el);
    else buttons.current.delete(key);
  };

  // The card being dragged. Kept here rather than read from the drag data, which some browsers
  // hide until the drop; files dragged in from the computer never set it.
  const dragId = useRef<string | null>(null);
  const isPageDrag = (e: DragEvent) =>
    dragId.current !== null && !Array.from(e.dataTransfer.types).includes('Files');
  const endDrag = () => {
    dragId.current = null;
    setDragging(null);
    setTarget(null);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <strong className="text-sm">
          {strings.summary(files.length)}{' '}
          <span className="font-normal text-muted">
            · {strings.summaryDetail(files.length, formatBytes(total))}
          </span>
        </strong>
        <span className="flex items-center gap-2">
          <span className="text-ui text-faint max-[560px]:hidden">{strings.dragHint}</span>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
            {strings.clearAll}
          </Button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 p-3.5 min-[560px]:grid-cols-3 min-[1000px]:grid-cols-4">
        <ol aria-label={strings.listLabel} className="m-0 contents list-none p-0">
          {files.map((file, i) => {
            const error = errors[file.id] ?? file.error;
            const src = file.thumbUrl ?? previews[file.id];
            const size =
              file.width && file.height ? { width: file.width, height: file.height } : undefined;
            return (
              <li
                key={file.id}
                draggable={!disabled}
                data-testid="page-card"
                data-dragging={dragging === file.id || undefined}
                data-target={(target === file.id && dragging !== file.id) || undefined}
                onDragStart={(e) => {
                  // Firefox only starts a drag that carries some data.
                  e.dataTransfer.setData(DRAG_TYPE, file.id);
                  e.dataTransfer.effectAllowed = 'move';
                  dragId.current = file.id;
                  setDragging(file.id);
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  if (!isPageDrag(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (target !== file.id) setTarget(file.id);
                }}
                onDragLeave={() => setTarget((t) => (t === file.id ? null : t))}
                onDrop={(e) => {
                  if (!isPageDrag(e)) return;
                  e.preventDefault();
                  const from = files.findIndex((f) => f.id === dragId.current);
                  endDrag();
                  if (from >= 0) move(from, i);
                }}
                className={cn(
                  'relative flex min-w-0 cursor-grab flex-col gap-2 rounded-[10px] border border-line bg-card p-2.5',
                  'transition-[border-color,opacity,transform] duration-150 hover:border-faint',
                  'data-[dragging]:opacity-40 data-[target]:scale-[1.02] data-[target]:border-accent',
                  error && 'border-bad',
                  disabled && 'cursor-default',
                )}
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 left-1.5 z-[1] grid h-[22px] min-w-[22px] place-items-center rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent"
                >
                  {i + 1}
                </span>
                <PagePreview
                  size={size}
                  src={src}
                  name={file.name}
                  options={options}
                  busy={previewBusy.has(file.id)}
                />
                <div className="min-w-0">
                  <div className="truncate text-ui font-medium" title={file.name}>
                    <span className="sr-only">{strings.pageNumber(i + 1)} </span>
                    {file.name}
                  </div>
                  <div className="flex justify-between gap-1.5 text-xs text-muted">
                    <span className="truncate">
                      {size ? strings.dims(size.width, size.height) : strings.sizeUnknown}
                    </span>
                    <span className="shrink-0">{formatBytes(file.size)}</span>
                  </div>
                  {previewBusy.has(file.id) && !error && (
                    <div className="sr-only">{strings.preparingPreview}</div>
                  )}
                  {error && (
                    <div className="mt-1 flex items-start gap-1 text-xs text-bad">
                      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      <span className="min-w-0 wrap-anywhere">{error}</span>
                    </div>
                  )}
                </div>
                <div className="mt-auto flex justify-between gap-1">
                  <span className="flex gap-0.5">
                    <IconButton
                      ref={ref(`${file.id}:earlier`)}
                      size="sm"
                      label={strings.moveEarlier(file.name)}
                      disabled={disabled || i === 0}
                      onClick={() => move(i, i - 1, { id: file.id, which: 'earlier' })}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      ref={ref(`${file.id}:later`)}
                      size="sm"
                      label={strings.moveLater(file.name)}
                      disabled={disabled || i === files.length - 1}
                      onClick={() => move(i, i + 1, { id: file.id, which: 'later' })}
                    >
                      <ArrowRight aria-hidden="true" />
                    </IconButton>
                  </span>
                  <IconButton
                    size="sm"
                    label={strings.removeFile(file.name)}
                    disabled={disabled}
                    onClick={() => {
                      onRemove(file.id);
                      setAnnouncement(strings.removed(file.name));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ol>
        {addTile}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Card>
  );
}
