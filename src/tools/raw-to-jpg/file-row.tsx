// One row of the RAW list: thumbnail from the camera's JPEG, name, camera and megapixels, size
// before → after with the new dimensions, plain notes, and the row's status on the right.

import { Camera, Check, Download, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { memo, useState } from 'react';
import type { Job } from '@/core/contracts';
import type { ImageJobInput, ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import { fitSize, type Size } from '@/core/sizing';
import { planSize, type ResizeValues } from '@/features/image-settings';
import { cn } from '@/lib/utils';
import { Badge, Button, IconButton, ProgressBar } from '@/ui';
import { formatBytes } from '@/tools/_shared';
import { formatMegapixels, type RawFileDetails } from './details';
import { rawResultNotes } from './notes';
import { rawToJpgStrings as t } from './strings';

export type RawJob = Job<ImageJobInput, ImageJobResult>;

export interface FileRowProps {
  file: IntakeFile;
  /** Undefined while the file is being read. */
  details: RawFileDetails | undefined;
  /** The file's job with the current settings; undefined before a run. */
  job: RawJob | undefined;
  /** Current settings: resize (planned size before a run) and mode (camera JPEG or develop). */
  resize: ResizeValues;
  fastMode: boolean;
  /** Output name once done (pattern applied, unique in the batch). */
  outName?: string;
  /** This device is a phone (wording of the half-size note). */
  phone: boolean;
  removable: boolean;
  onRemove: (fileId: string) => void;
  onRetry: (fileId: string) => void;
  onDownload: (fileId: string) => void;
  last: boolean;
}

/** Aspect-correct placeholder when the file has no camera JPEG to show. Size from the sizing rule. */
function Shape({ source }: { source: Size }) {
  const shape = fitSize(source, { mode: 'longest', value: 32, upscale: true });
  return (
    <span
      aria-hidden="true"
      className="block rounded-[3px] bg-accent-shape"
      style={{ width: shape.width, height: shape.height }}
    />
  );
}

const dims = (s: Size) => `${s.width}×${s.height}`;

function FileRowImpl({
  file,
  details,
  job,
  resize,
  fastMode,
  outName,
  phone,
  removable,
  onRemove,
  onRetry,
  onDownload,
  last,
}: FileRowProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const ready = details?.status === 'ready' ? details : undefined;
  const readError = details?.status === 'error' && details.message ? details.message : undefined;
  const source = ready ? { width: ready.width, height: ready.height } : null;
  const result = job?.status === 'done' ? job.result : undefined;
  const status = readError ? 'failed' : (job?.status ?? (details ? 'waiting' : 'reading'));

  // Before the run: what the settings will do. After: what the pipeline did.
  let to: string | null = null;
  if (result) {
    to = dims(result);
  } else if (source && resize.resizeEnabled && resize.resizeMode !== 'none') {
    const plan = planSize(source, resize);
    if (plan) to = dims(plan.output);
  }
  const tag =
    !result && ready && fastMode ? (ready.cameraJpeg ? t.cameraJpegTag : t.developTag) : null;
  const notes = result
    ? rawResultNotes(result, {
        bytes: file.size,
        resized:
          source !== null && (result.width !== source.width || result.height !== source.height),
        mode: fastMode ? 'fast' : 'full',
        phone,
      })
    : [];
  const error = readError ?? (status === 'failed' ? job?.error : undefined);

  return (
    <div
      className={cn(
        'grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5',
        !last && 'border-b border-line',
      )}
      data-status={status}
    >
      <span className="grid size-11 place-items-center overflow-hidden rounded-lg bg-sunk">
        {ready?.thumbUrl && !thumbFailed ? (
          <img
            src={ready.thumbUrl}
            alt=""
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="size-full object-contain"
          />
        ) : source ? (
          <Shape source={source} />
        ) : details ? (
          <Camera aria-hidden="true" className="size-5 text-faint" />
        ) : (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-faint" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium" title={outName ?? file.name}>
          {outName ?? file.name}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {ready?.camera && <span className="truncate">{ready.camera}</span>}
          {source && (
            <span className="font-mono" data-testid="row-dims">
              <span className="whitespace-nowrap">{formatMegapixels(source)}</span> ·{' '}
              <span className="whitespace-nowrap">
                <span className="sr-only">{t.dims}: </span>
                {dims(source)}
              </span>
              {to !== null && <span className="whitespace-nowrap text-accent"> → {to}</span>}
            </span>
          )}
          {tag && <span className="text-faint">{tag}</span>}
          <span className="font-mono whitespace-nowrap" data-testid="row-bytes">
            <span className="sr-only">{t.originalSize}: </span>
            {formatBytes(file.size)}
            {result && (
              <>
                {' → '}
                <span className="sr-only">{t.newSize}: </span>
                <strong className="font-medium text-fg">{formatBytes(result.bytes)}</strong>
              </>
            )}
          </span>
        </span>
        {result && notes.length > 0 && (
          <span className="mt-0.5 flex flex-col text-xs" data-testid="row-notes">
            {notes.map((note) => (
              <span key={note.id} className={note.tone === 'warn' ? 'text-warn' : 'text-faint'}>
                {note.text}
              </span>
            ))}
          </span>
        )}
        {error && (
          <span className="mt-0.5 block text-xs text-bad" data-testid="row-error">
            {error}
          </span>
        )}
        {status === 'cancelled' && (
          <span className="mt-0.5 block text-xs text-muted">{t.cancelledReason}</span>
        )}
      </span>
      <span className="flex items-center justify-end gap-1.5 text-xs tabular-nums">
        {status === 'reading' && (
          <span className="text-faint" aria-label={t.readingLabel(file.name)}>
            {t.reading}
          </span>
        )}
        {status === 'waiting' && job && <span className="text-faint">{t.waiting}</span>}
        {status === 'working' && (
          <ProgressBar value={job?.progress ?? 0} label={t.progressLabel(file.name)} />
        )}
        {result && (
          <>
            <Badge
              variant="ok"
              aria-label={t.doneLabel(formatBytes(result.bytes))}
              className="max-[480px]:hidden"
            >
              <Check aria-hidden="true" />
              {formatBytes(result.bytes)}
            </Badge>
            <IconButton
              size="sm"
              label={t.downloadLabel(outName ?? file.name)}
              onClick={() => onDownload(file.id)}
            >
              <Download aria-hidden="true" />
            </IconButton>
          </>
        )}
        {!readError && (status === 'failed' || status === 'cancelled') && (
          <>
            <Badge variant={status === 'failed' ? 'bad' : 'default'} className="max-[480px]:hidden">
              {status === 'failed' ? t.failed : t.cancelled}
            </Badge>
            <Button size="sm" onClick={() => onRetry(file.id)} aria-label={t.retryLabel(file.name)}>
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {t.retry}
            </Button>
          </>
        )}
        {removable && status !== 'working' && (
          <IconButton size="sm" label={t.removeLabel(file.name)} onClick={() => onRemove(file.id)}>
            <X aria-hidden="true" />
          </IconButton>
        )}
      </span>
    </div>
  );
}

export const FileRow = memo(FileRowImpl);
