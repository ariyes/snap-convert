import {
  Check,
  CircleAlert,
  Download,
  ImageIcon,
  Info,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import type { IntakeFile } from '@/core/contracts/intake';
import type { PresetId } from '@/engines/optimize';
import { Button, IconButton, ProgressBar } from '@/ui';
import {
  describeResult,
  formatBytes,
  plannedSizeText,
  sizeText,
  smallImageWarning,
  type ResultNote,
} from './result';
import { optimizeStrings as t } from './strings';
import type { OptimizeJob } from './use-optimize-run';

export interface FileRowProps {
  file: IntakeFile;
  job: OptimizeJob | undefined;
  destination: PresetId;
  /** Export name (`<name>-web.<ext>`) once done. */
  outName?: string;
  /** False while files are being worked on: no removing then. */
  canRemove: boolean;
  onRemove: () => void;
  onRetry: () => void;
  onDownload: () => void;
  onUseJpeg: () => void;
}

/** One image: before → after size, status, the checklist and any notes or warnings. */
export function FileRow({
  file,
  job,
  destination,
  outName,
  canRemove,
  onRemove,
  onRetry,
  onDownload,
  onUseJpeg,
}: FileRowProps) {
  const source =
    file.width !== undefined && file.height !== undefined
      ? { width: file.width, height: file.height }
      : undefined;
  const result = job?.status === 'done' ? job.result : undefined;
  const report = result ? describeResult(result, file.size, source) : null;
  // Without a size from intake, the result's size tells (it is never enlarged).
  const warning = smallImageWarning(source ?? result, destination);
  const dims = result
    ? source && (source.width !== result.width || source.height !== result.height)
      ? `${sizeText(source)} → ${sizeText(result)}`
      : sizeText(result)
    : plannedSizeText(source, destination);
  const [from, to] = (dims ?? '').split(' → ');
  const name = result && outName ? outName : file.name;
  const hasDetails = report !== null || warning !== null || job?.status === 'failed';

  return (
    <li
      data-testid="file-row"
      data-status={job?.status ?? 'waiting'}
      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 border-b border-line px-3.5 py-3 last:border-b-0"
    >
      <span className="grid size-11 place-items-center overflow-hidden rounded-lg bg-sunk">
        {file.thumbUrl ? (
          <img src={file.thumbUrl} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon aria-hidden="true" className="size-5 text-faint" />
        )}
      </span>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium" title={name}>
          {name}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted">
          {dims && (
            <span data-testid="file-dims">
              {from}
              {to !== undefined && <span className="text-accent"> → {to}</span>}
            </span>
          )}
          <span data-testid="file-bytes">
            {formatBytes(file.size)}
            {result && <span className="text-accent"> → {formatBytes(result.bytes)}</span>}
          </span>
        </span>
      </div>

      <span className="flex min-h-11 items-center justify-end gap-1.5 text-xs text-faint tabular-nums">
        {(!job || job.status === 'waiting') && <span>{t.waiting}</span>}
        {job?.status === 'working' && (
          <ProgressBar value={job.progress} label={t.progressLabel(file.name)} />
        )}
        {job?.status === 'cancelled' && <span>{t.cancelled}</span>}
        {(job?.status === 'failed' || job?.status === 'cancelled') && (
          <IconButton size="sm" label={t.retryFile(file.name)} onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
          </IconButton>
        )}
        {result && (
          <IconButton size="sm" label={t.downloadFile(name)} onClick={onDownload}>
            <Download aria-hidden="true" />
          </IconButton>
        )}
        {canRemove && (
          <IconButton size="sm" label={t.removeFile(file.name)} onClick={onRemove}>
            <X aria-hidden="true" />
          </IconButton>
        )}
      </span>

      {hasDetails && (
        <div className="col-span-2 col-start-2 flex min-w-0 flex-col gap-1 max-[560px]:col-span-3 max-[560px]:col-start-1">
          {report && (
            <ul
              aria-label={t.checklistLabel}
              data-testid="checklist"
              className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-xs text-muted"
            >
              {report.checklist.map((item) => (
                <li key={item.text} className="inline-flex items-center gap-1">
                  <Check aria-hidden="true" className="size-3.5 text-ok" />
                  {item.text}
                </li>
              ))}
            </ul>
          )}
          {report?.notes.map((note) => (
            <NoteLine key={note.kind} note={note} onUseJpeg={onUseJpeg} />
          ))}

          {warning && (
            <p
              data-testid="small-warning"
              className="m-0 flex items-start gap-1.5 text-xs text-warn"
            >
              <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              {warning}
            </p>
          )}
          {job?.status === 'failed' && (
            <p role="alert" className="m-0 flex items-start gap-1.5 text-xs text-bad">
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              {job.error ?? t.failed}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function NoteLine({ note, onUseJpeg }: { note: ResultNote; onUseJpeg: () => void }) {
  const warn = note.kind === 'larger';
  const Icon = warn ? TriangleAlert : Info;
  return (
    <p
      data-testid={`note-${note.kind}`}
      className={
        warn
          ? 'm-0 flex items-start gap-1.5 text-xs text-warn'
          : 'm-0 flex items-start gap-1.5 text-xs text-muted'
      }
    >
      <Icon
        aria-hidden="true"
        className={warn ? 'mt-px size-3.5 shrink-0' : 'mt-px size-3.5 shrink-0 text-accent'}
      />
      <span className="min-w-0">
        {note.text}
        {note.kind === 'graphic' && (
          <>
            {' '}
            <Link to="/convert-image" className="text-accent">
              {t.graphicLink}
            </Link>
          </>
        )}
        {note.kind === 'larger' && note.suggestJpeg && (
          <>
            {' '}
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={onUseJpeg}>
              {t.tryJpg}
            </Button>
          </>
        )}
      </span>
    </p>
  );
}
