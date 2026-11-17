// One row of the Bulk file list (prototype `.file`): thumbnail, name, "4032×3024 → 1920×1440"
// with tags, original size, and the row's status on the right.

import { Check, ImageIcon, RotateCcw, X } from 'lucide-react';
import { memo, useState } from 'react';
import type { Job } from '@/core/contracts';
import type { ImageJobInput, ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import { fitSize, type Size } from '@/core/sizing';
import { imageSettingsStrings, planSize, type ResizeValues } from '@/features/image-settings';
import { cn } from '@/lib/utils';
import { Badge, Button, IconButton, ProgressBar } from '@/ui';
import { formatBytes } from '@/tools/_shared';
import { bulkStrings as t } from './strings';

export type BulkJob = Job<ImageJobInput, ImageJobResult>;

export interface FileRowProps {
  file: IntakeFile;
  /** The file's current job; undefined when it hasn't run with the current settings. */
  job: BulkJob | undefined;
  /** Current resize settings (for the planned size before a run). */
  resize: ResizeValues;
  /** Output file name once done (pattern applied, unique in the batch). */
  outName?: string;
  /** Show the remove button (nothing is running). */
  removable: boolean;
  onRemove: (fileId: string) => void;
  onRetry: (fileId: string) => void;
  last: boolean;
}

/** Aspect-correct placeholder for files without a browser preview (HEIC). Size from the sizing rule. */
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
  job,
  resize,
  outName,
  removable,
  onRemove,
  onRetry,
  last,
}: FileRowProps) {
  /** The browser couldn't show the file (e.g. a broken download): show an icon instead. */
  const [thumbFailed, setThumbFailed] = useState(false);
  const source = file.width && file.height ? { width: file.width, height: file.height } : null;
  const result = job?.status === 'done' ? job.result : undefined;
  const status = job?.status ?? 'waiting';

  // Before the run: what the settings will do. After: what the pipeline did.
  let to: string | null = null;
  const tags: string[] = [];
  if (result) {
    to = dims(result);
    if (result.notes.includes('not-enlarged')) tags.push(t.notEnlarged);
    if (result.notes.includes('padded')) tags.push(t.padded);
    if (result.notes.includes('cropped')) tags.push(t.cropped);
    if (result.notes.includes('kept-original')) tags.push(t.keptOriginal);
    if (result.notes.includes('format-fallback')) {
      tags.push(t.formatFallback(imageSettingsStrings.formatNames[result.format]));
    }
  } else if (source && resize.resizeMode !== 'none') {
    const plan = planSize(source, resize);
    if (plan) {
      to = dims(plan.output);
      if (plan.notEnlarged && !plan.padded) tags.push(t.notEnlarged);
      if (plan.padded) tags.push(t.padded);
      if (plan.cropped) tags.push(t.cropped);
    }
  }
  const larger = result !== undefined && result.bytes > file.size;
  if (larger) tags.push(t.larger);

  return (
    <div
      className={cn(
        'grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5',
        !last && 'border-b border-line',
      )}
      data-status={status}
    >
      <span className="grid size-11 place-items-center overflow-hidden rounded-lg bg-sunk">
        {file.thumbUrl && !thumbFailed ? (
          <img
            src={file.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="size-full object-contain"
          />
        ) : source ? (
          <Shape source={source} />
        ) : (
          <ImageIcon aria-hidden="true" className="size-5 text-faint" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium" title={outName ?? file.name}>
          {outName ?? file.name}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted">
          {source && (
            <span className="whitespace-nowrap">
              <span className="sr-only">{t.dims}: </span>
              {dims(source)}
              {to !== null && <span className="text-accent"> → {to}</span>}
            </span>
          )}
          {tags.map((tag) => (
            <span key={tag} className={tag === t.larger ? 'text-warn' : 'text-faint'}>
              {tag}
            </span>
          ))}
          <span>
            <span className="sr-only">{t.originalSize}: </span>
            {formatBytes(file.size)}
          </span>
        </span>
        {status === 'failed' && (
          <span className="mt-0.5 block text-xs text-bad" data-testid="row-error">
            {job?.error}
          </span>
        )}
        {status === 'cancelled' && (
          <span className="mt-0.5 block text-xs text-muted">{t.cancelledReason}</span>
        )}
      </span>
      <span className="flex items-center justify-end gap-1.5 text-xs tabular-nums">
        {status === 'waiting' && <span className="text-faint">{t.waiting}</span>}
        {status === 'working' && (
          <ProgressBar value={job?.progress ?? 0} label={t.progressLabel(file.name)} />
        )}
        {result && (
          <Badge
            variant={larger ? 'warn' : 'ok'}
            aria-label={t.doneLabel(formatBytes(result.bytes))}
          >
            <Check aria-hidden="true" />
            {formatBytes(result.bytes)}
          </Badge>
        )}
        {(status === 'failed' || status === 'cancelled') && (
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
