// The left column of the Compress workspace (prototype `.stage`): thumbnails, the before/after
// slider, the size stats, notes on the result, and the file row with Add / Remove.
import { CircleAlert, ImageIcon, LoaderCircle, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import { acceptAttribute } from '@/features/intake';
import { cn } from '@/lib/utils';
import { Button, Card, CompareSlider, Note, ProgressBar } from '@/ui';
import { formatBytes, formatTimeLeft } from '@/tools/_shared';
import { savedPercent, savedText } from './format';
import type { ResultNote } from './notes';
import { ACCEPT } from './settings';
import { compressStrings as t } from './strings';
import type { FileJob } from './use-compress-jobs';

export interface Shown {
  fileId: string;
  result: ImageJobResult;
  url: string;
}

export interface StageProps {
  files: readonly IntakeFile[];
  selected: IntakeFile;
  onSelect: (id: string) => void;
  /** Each file's job for the current settings. */
  byFile: ReadonlyMap<string, FileJob>;
  /** The last result shown for the selected file, with its object URL (may be stale). */
  shown: Shown | null;
  /** `shown` was made with the current settings. */
  fresh: boolean;
  notes: readonly ResultNote[];
  onNoteAction: (note: ResultNote) => void;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  /** Several files: how many are finished, and the time left. */
  progress: { done: number; failed: number; total: number; etaSeconds: number | null } | null;
}

export function Stage({
  files,
  selected,
  onSelect,
  byFile,
  shown,
  fresh,
  notes,
  onNoteAction,
  onAdd,
  onRemove,
  onRetry,
  progress,
}: StageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [brokenOriginal, setBrokenOriginal] = useState<string | null>(null);
  const job = byFile.get(selected.id);
  const result = shown?.fileId === selected.id ? shown : null;
  const failed = job?.status === 'failed';
  const busy = !fresh && !failed;

  // Shape of the frame: the result's upright size, else intake's (also upright).
  const width = result?.result.width ?? selected.width;
  const height = result?.result.height ?? selected.height;
  const aspect = width && height ? width / height : 3 / 2;

  const originalUrl = brokenOriginal === selected.id ? undefined : selected.thumbUrl;
  const beforeUrl = originalUrl ?? result?.url;
  const afterUrl = result?.url ?? originalUrl;

  const addButton = (extra?: string) => (
    <Button
      variant="ghost"
      size="sm"
      className={extra}
      onClick={() => inputRef.current?.click()}
      aria-label={files.length > 1 ? t.addImages : undefined}
    >
      <Plus aria-hidden="true" />
      {files.length > 1 ? null : t.addImages}
    </Button>
  );

  return (
    <Card className="flex flex-col gap-3 p-3" aria-label={t.filesLabel} role="region">
      {files.length > 1 && (
        <div role="group" aria-label={t.thumbsLabel} className="flex gap-2 overflow-x-auto pb-0.5">
          {files.map((f) => {
            const status = byFile.get(f.id)?.status;
            return (
              <button
                key={f.id}
                type="button"
                aria-label={f.name}
                aria-current={f.id === selected.id}
                onClick={() => onSelect(f.id)}
                className={cn(
                  'relative grid size-14 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-lg border-2 border-transparent bg-sunk p-0',
                  'aria-[current=true]:border-accent',
                )}
              >
                {f.thumbUrl ? (
                  <img src={f.thumbUrl} alt="" className="block size-full object-cover" />
                ) : (
                  <ImageIcon aria-hidden="true" className="size-5 text-faint" />
                )}
                {status === 'failed' && (
                  <span className="absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-full bg-bad text-on-accent">
                    <CircleAlert aria-hidden="true" className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
          {addButton('h-14 shrink-0 px-4')}
        </div>
      )}

      {progress && progress.done + progress.failed < progress.total && (
        <div className="flex flex-col gap-1.5 text-ui text-muted" role="status">
          <span>
            {t.progress(progress.done, progress.total)}
            {progress.etaSeconds !== null && ` · ${formatTimeLeft(progress.etaSeconds)}`}
          </span>
          <ProgressBar
            size="lg"
            label={t.progressLabel}
            value={progress.total ? progress.done / progress.total : 0}
          />
        </div>
      )}

      <div
        className="relative mx-auto w-full"
        style={{ maxWidth: `calc(62vh * ${aspect.toFixed(4)})` }}
        data-testid="compare"
        data-fresh={fresh || undefined}
      >
        <CompareSlider
          aspectRatio={aspect}
          before={
            beforeUrl ? (
              <img
                src={beforeUrl}
                alt=""
                onError={() => {
                  if (beforeUrl === originalUrl) setBrokenOriginal(selected.id);
                }}
              />
            ) : null
          }
          after={
            afterUrl ? (
              <img
                src={afterUrl}
                alt=""
                data-testid="compare-after"
                className={cn('transition-opacity duration-150', busy && result && 'opacity-60')}
              />
            ) : null
          }
        />
        {busy && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-scrim px-3 py-1 text-xs font-medium text-on-scrim">
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              {result ? t.updating : t.working}
            </span>
          </div>
        )}
      </div>

      <dl aria-label={t.statsLabel} className="m-0 grid grid-cols-3 gap-2">
        <Stat label={t.original}>{formatBytes(selected.size)}</Stat>
        <Stat label={t.newSize} testId="new-size">
          {failed ? (
            <span className="text-bad">{t.failed}</span>
          ) : fresh && result ? (
            formatBytes(result.result.bytes)
          ) : (
            <Spinner />
          )}
        </Stat>
        <Stat
          label={t.saved}
          testId="saved"
          tone={
            fresh && result && savedPercent(selected.size, result.result.bytes) > 0
              ? 'ok'
              : undefined
          }
        >
          {fresh && result ? savedText(selected.size, result.result.bytes) : failed ? '—' : '…'}
        </Stat>
      </dl>

      {failed && (
        <Note icon={CircleAlert} role="alert">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{job.error}</span>
            <Button size="sm" onClick={() => onRetry(selected.id)}>
              {t.retry}
            </Button>
          </span>
        </Note>
      )}

      {fresh &&
        notes.map((note) => (
          <Note
            key={note.id}
            icon={note.tone === 'warn' ? TriangleAlert : undefined}
            data-testid={`note-${note.id}`}
            className={cn('items-center', note.tone === 'warn' && 'bg-warn-bg text-warn')}
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>{note.text}</span>
              {note.action && (
                <Button
                  size="sm"
                  onClick={() => onNoteAction(note)}
                  disabled={note.action.pending}
                  aria-busy={note.action.pending || undefined}
                >
                  {note.action.pending && (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  )}
                  {note.action.label}
                </Button>
              )}
            </span>
          </Note>
        ))}

      {!originalUrl && result && <Note>{t.cantShowOriginal}</Note>}

      {import.meta.env.DEV && fresh && result && (
        // Dev-only check of the crispness standard (D24); never in production builds.
        <p data-testid="debug-ssim" className="m-0 font-mono text-xs text-faint">
          SSIM {result.result.ssim.toFixed(4)} · quality {result.result.quality} ·{' '}
          {result.result.format}
          {result.result.encodes !== undefined && ` · ${result.result.encodes} encodes`}
          {result.result.guard && ` · guard +${result.result.guard.steps}`}
          {result.result.notes.length > 0 && ` · ${result.result.notes.join(', ')}`}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="flex min-w-0 flex-[1_1_140px] items-baseline gap-2">
          <span className="truncate text-sm font-medium">{selected.name}</span>
          {result && (
            <span
              className="shrink-0 font-mono text-xs text-muted"
              data-testid="result-dims"
              aria-label={t.dimsLabel}
            >
              {t.dims(result.result.width, result.result.height)}
            </span>
          )}
        </span>
        <span className="flex shrink-0 gap-1.5">
          {files.length === 1 && addButton()}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(selected.id)}
            aria-label={t.removeLabel(selected.name)}
          >
            <Trash2 aria-hidden="true" />
            {t.remove}
          </Button>
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={acceptAttribute(ACCEPT)}
        onChange={(e) => {
          const picked = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (picked.length > 0) onAdd(picked);
        }}
      />
    </Card>
  );
}

function Stat({
  label,
  children,
  tone,
  testId,
}: {
  label: string;
  children: ReactNode;
  tone?: 'ok';
  testId?: string;
}) {
  return (
    <div className="min-w-0 rounded-control bg-sunk px-3 py-2.5">
      <dt className="text-xs text-faint">{label}</dt>
      <dd
        className={cn(
          'm-0 truncate text-base font-semibold tabular-nums',
          tone === 'ok' && 'text-ok',
        )}
        data-testid={testId}
      >
        {children}
      </dd>
    </div>
  );
}

function Spinner() {
  return (
    <LoaderCircle
      aria-label={t.working}
      role="img"
      className="mt-1 size-4 animate-spin text-muted"
    />
  );
}
