// Resize PDF (PDF-05, P20): one or more PDFs → every page on one paper size, content scaled
// uniformly to fit and centred (never stretched). Runs `resize-pages` in the PDF worker through
// the shared queue; results download one by one or as a ZIP.
import { CircleAlert, Download, FileCheck2, LoaderCircle, Scan, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { usePendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import type { Job } from '@/core/contracts';
import type { IntakeFile } from '@/core/contracts/intake';
import type { PdfInfo, PdfOutput, PdfResult, ResizePagesInput } from '@/core/contracts/pdf';
import { useQueue } from '@/core/queue';
import { readPdfInfo } from '@/engines/pdf';
import { downloadBlob, ExportBar } from '@/features/export';
import { DropZone, keepAccepted, toIntakeFiles, useFileList } from '@/features/intake';
import { useToolSettings } from '@/features/settings';
import {
  Field,
  PanelDivider,
  PanelSection,
  ToolEmptyState,
  ToolPage,
  Workspace,
} from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import {
  Badge,
  Button,
  Card,
  Helper,
  IconButton,
  Label,
  Note,
  NumberField,
  ProgressBar,
  Segmented,
  Select,
} from '@/ui';
import { PagePreview, RowThumb } from './preview';
import {
  convertSide,
  formatSide,
  matchNamedSize,
  ORIENTATIONS,
  pageSizeInput,
  RESIZE_DEFAULTS,
  resizeSettingsSchema,
  settingsKey,
  SIZE_CHOICES,
  UNIT_LIMITS,
  type ResizeSettings,
  type Unit,
} from './settings';
import { formatBytes } from '@/tools/_shared';
import { resizeStrings as t } from './strings';

const TOOL = 'resize-pdf';
const ACCEPT = ['pdf'] as const;
const noSubscribe = () => () => {};

type InfoState = { status: 'reading' } | { status: 'ready'; info: PdfInfo } | { status: 'error' };

/** The latest job for a file and the settings it ran with. */
interface FileRun {
  jobId: string;
  key: string;
}

interface Row {
  file: IntakeFile;
  info: InfoState;
  /** Readable, not password-protected, has pages. */
  usable: boolean;
  encrypted: boolean;
  /** This file's job for the current settings, if any. */
  job: Job | undefined;
  result: PdfOutput | undefined;
}

function isPdfResult(value: unknown): value is PdfResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { files?: unknown }).files)
  );
}

const baseName = (name: string) => name.replace(/\.pdf$/i, '') || 'document';
const isActive = (job: Job | undefined) => job?.status === 'waiting' || job?.status === 'working';

/** Reads every file once (pages, sizes, password) with pdf.js. */
function usePdfInfos(files: readonly IntakeFile[]): Record<string, InfoState> {
  const [infos, setInfos] = useState<Record<string, InfoState>>({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const f of files) {
      if (requested.current.has(f.id)) continue;
      requested.current.add(f.id);
      readPdfInfo(f.file).then(
        (info) => setInfos((prev) => ({ ...prev, [f.id]: { status: 'ready', info } })),
        () => setInfos((prev) => ({ ...prev, [f.id]: { status: 'error' } })),
      );
    }
  }, [files]);
  return infos;
}

export default function ToolRoute() {
  const page = useToolPage();
  const files = useFileList(TOOL, (s) => s.files);
  const add = useFileList(TOOL, (s) => s.add);
  // The page takes files once its code has loaded (end-to-end tests wait for this).
  const live = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  const take = (list: readonly IntakeFile[]) => {
    add(list);
  };
  usePendingFiles(TOOL, (raw) => {
    void toIntakeFiles(raw).then((list) => add(keepAccepted(list, ACCEPT)));
  });

  return (
    <div data-testid="resize-pdf" data-live={live || undefined} className="contents">
      <ToolPage
        meta={page}
        hasFiles={files.length > 0}
        empty={
          <ToolEmptyState
            dropZone={
              <DropZone
                accept={ACCEPT}
                multiple
                onFiles={take}
                title={t.dropTitle}
                subtitle={t.dropSubtitle}
              />
            }
          />
        }
        workspace={files.length > 0 && <Resize files={files} onAdd={take} />}
      />
    </div>
  );
}

function Resize({
  files,
  onAdd,
}: {
  files: readonly IntakeFile[];
  onAdd: (files: IntakeFile[]) => void;
}) {
  const removeFile = useFileList(TOOL, (s) => s.remove);
  const clearFiles = useFileList(TOOL, (s) => s.clear);
  const [settings, update, reset] = useToolSettings(TOOL, RESIZE_DEFAULTS, resizeSettingsSchema);
  const infos = usePdfInfos(files);
  const key = settingsKey(settings);
  const [runs, setRuns] = useState<Record<string, FileRun>>({});
  const jobs = useQueue((s) => s.jobs);
  const jobIds = useRef(new Set<string>());
  const resultRef = useRef<HTMLDivElement>(null);
  const sizeId = useId();
  const widthId = useId();
  const heightId = useId();

  // Jobs belong to this page: drop them (and their result blobs) when it closes.
  useEffect(() => {
    const ids = jobIds.current;
    return () => {
      const queue = useQueue.getState();
      for (const id of ids) queue.remove(id);
    };
  }, []);

  const rows: Row[] = files.map((file) => {
    const info = infos[file.id] ?? { status: 'reading' };
    const encrypted = info.status === 'ready' && info.info.encrypted;
    const usable = info.status === 'ready' && !encrypted && info.info.pages > 0;
    const run = runs[file.id];
    const job = run && run.key === key ? jobs.find((j) => j.id === run.jobId) : undefined;
    const result =
      job?.status === 'done' && isPdfResult(job.result) ? job.result.files[0] : undefined;
    return { file, info, usable, encrypted, job, result };
  });

  const working = rows.some((r) => isActive(r.job));
  const reading = rows.some((r) => r.info.status === 'reading');
  const pending = rows.filter(
    (r) => r.usable && (!r.job || r.job.status === 'failed' || r.job.status === 'cancelled'),
  );
  const done = rows.filter((r): r is Row & { result: PdfOutput } => r.result !== undefined);
  const failed = rows.filter((r) => r.job?.status === 'failed');
  const inRun = rows.filter((r) => isActive(r.job) || r.job?.status === 'done');
  const runProgress =
    inRun.length === 0
      ? 0
      : inRun.reduce((sum, r) => sum + (r.job?.status === 'done' ? 1 : (r.job?.progress ?? 0)), 0) /
        inRun.length;
  const percent = Math.round(runProgress * 100);
  const preview = rows.find((r) => r.usable);
  const showResults = done.length > 0 && !working;

  // Bring the results into view when a run finishes (on phones they sit under the file list).
  useEffect(() => {
    if (showResults) resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [showResults]);

  const start = () => {
    if (working || reading || pending.length === 0) return;
    const queue = useQueue.getState();
    const pageSize = pageSizeInput(settings);
    const next: Record<string, FileRun> = {};
    for (const row of pending) {
      const old = runs[row.file.id];
      if (old) {
        queue.remove(old.jobId);
        jobIds.current.delete(old.jobId);
      }
      const input: ResizePagesInput = {
        file: { blob: row.file.file, name: row.file.name },
        pageSize,
        orientation: settings.orientation,
        outName: `${baseName(row.file.name)}-${t.outSuffix(settings.size)}`,
      };
      const [jobId] = queue.add('pdf', 'resize-pages', [{ label: row.file.name, input }]);
      if (!jobId) continue;
      jobIds.current.add(jobId);
      next[row.file.id] = { jobId, key };
    }
    setRuns((prev) => ({ ...prev, ...next }));
    queue.start();
    track({ name: 'tool-run', tool: TOOL, files: pending.length });
  };

  const cancel = () => {
    const queue = useQueue.getState();
    for (const row of rows) if (row.job && isActive(row.job)) queue.cancel(row.job.id);
  };

  const dropJob = (fileId: string) => {
    const run = runs[fileId];
    if (!run) return;
    useQueue.getState().remove(run.jobId);
    jobIds.current.delete(run.jobId);
  };

  const removeOne = (fileId: string) => {
    dropJob(fileId);
    removeFile(fileId);
  };

  const removeAll = () => {
    for (const row of rows) dropJob(row.file.id);
    setRuns({});
    clearFiles();
  };

  const changeUnit = (unit: Unit) => {
    if (unit === settings.unit) return;
    update({
      unit,
      customWidth: convertSide(settings.customWidth, settings.unit, unit),
      customHeight: convertSide(settings.customHeight, settings.unit, unit),
    });
  };

  const totalPages = rows.reduce(
    (sum, r) => sum + (r.info.status === 'ready' ? r.info.info.pages : 0),
    0,
  );
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const limits = UNIT_LIMITS[settings.unit];

  const main = (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <strong>
          {t.listCount(files.length)}{' '}
          <span className="font-normal text-muted">
            · {t.listDetail(totalPages, formatBytes(totalBytes))}
          </span>
        </strong>
        <Button variant="ghost" size="sm" onClick={removeAll} disabled={working}>
          <Trash2 aria-hidden="true" />
          {t.clearAll}
        </Button>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <FileRow
            key={row.file.id}
            row={row}
            settings={settings}
            working={working}
            onRemove={() => removeOne(row.file.id)}
          />
        ))}
      </ul>
      <div className="border-t border-line p-3.5">
        <DropZone
          accept={ACCEPT}
          multiple
          size="small"
          onFiles={onAdd}
          title={t.addMore}
          disabled={working}
        />
      </div>
    </Card>
  );

  const panel = (
    <>
      <PanelSection>
        <Field>
          <Label htmlFor={sizeId}>{t.pageSize}</Label>
          <Select
            id={sizeId}
            value={settings.size}
            onValueChange={(size) => update({ size })}
            options={SIZE_CHOICES.map((value) => ({ value, label: t.sizeOptions[value] }))}
            disabled={working}
          />
        </Field>
        {settings.size === 'custom' && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Field>
                <Label htmlFor={widthId}>{t.width}</Label>
                <NumberField
                  id={widthId}
                  value={settings.customWidth}
                  onValueChange={(customWidth) => update({ customWidth })}
                  min={limits.min}
                  max={limits.max}
                  step={limits.step}
                  decimals
                  unit={t.units[settings.unit]}
                  disabled={working}
                />
              </Field>
              <Field>
                <Label htmlFor={heightId}>{t.height}</Label>
                <NumberField
                  id={heightId}
                  value={settings.customHeight}
                  onValueChange={(customHeight) => update({ customHeight })}
                  min={limits.min}
                  max={limits.max}
                  step={limits.step}
                  decimals
                  unit={t.units[settings.unit]}
                  disabled={working}
                />
              </Field>
            </div>
            <Segmented<Unit>
              label={t.unit}
              value={settings.unit}
              onValueChange={changeUnit}
              options={[
                { value: 'mm', label: t.units.mm },
                { value: 'in', label: t.units.in },
              ]}
              disabled={working}
            />
          </>
        )}
      </PanelSection>
      <PanelSection>
        <span className="text-ui font-medium text-muted">{t.orientation}</span>
        <Segmented
          label={t.orientation}
          value={settings.orientation}
          onValueChange={(orientation) => update({ orientation })}
          options={ORIENTATIONS.map((value) => ({ value, label: t.orientations[value] }))}
          disabled={working}
        />
        <Helper>{t.orientationHelp[settings.orientation]}</Helper>
      </PanelSection>
      <PanelDivider />
      <PanelSection>
        <span className="text-ui font-medium text-muted">{t.previewTitle}</span>
        {preview?.info.status === 'ready' && preview.info.info.pageSizes[0] ? (
          <PagePreview
            file={preview.file.file}
            fileName={preview.file.name}
            content={preview.info.info.pageSizes[0]}
            settings={settings}
          />
        ) : (
          <Helper>{t.previewEmpty}</Helper>
        )}
      </PanelSection>
      <Note>{t.limits}</Note>
      {working && (
        <PanelSection>
          <span className="text-ui font-medium text-muted">{t.resizing(percent)}</span>
          <ProgressBar value={runProgress} label={t.resizing(percent)} size="lg" />
        </PanelSection>
      )}
      {showResults && (
        <div ref={resultRef} className="flex flex-col gap-3">
          <div
            role="status"
            data-testid="resize-result"
            className="flex items-center gap-3.5 rounded-xl bg-ok-bg p-4 text-ok"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-card">
              <FileCheck2 aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0 text-ui">
              <strong className="block text-fg">{t.resultTitle(done.length)}</strong>
              {t.resultLine(
                done.reduce((sum, r) => sum + r.result.pages, 0),
                formatBytes(done.reduce((sum, r) => sum + r.result.blob.size, 0)),
              )}
            </span>
          </div>
          {failed.length > 0 && (
            <p role="alert" className="m-0 flex items-start gap-2 text-sm text-bad">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t.someFailed(failed.length)}
            </p>
          )}
          <ExportBar
            files={done.map((r) => r.result)}
            zipName={t.zipName}
            onExport={(kind) => track({ name: 'download', tool: TOOL, kind })}
          />
        </div>
      )}
    </>
  );

  let actions;
  if (working) {
    actions = (
      <>
        <Button variant="primary" size="lg" block disabled>
          <LoaderCircle aria-hidden="true" className="animate-spin" />
          {t.resizing(percent)}
        </Button>
        <Button size="lg" block onClick={cancel}>
          <X aria-hidden="true" />
          {t.cancel}
        </Button>
      </>
    );
  } else if (pending.length > 0 || done.length === 0) {
    const blocked = reading || pending.length === 0;
    actions = (
      <>
        {blocked && (
          <Helper className="max-[880px]:hidden">
            {reading ? t.stillReading : t.noneToResize}
          </Helper>
        )}
        <Button variant="primary" size="lg" block onClick={start} disabled={blocked}>
          <Scan aria-hidden="true" />
          {t.resize(pending.length)}
        </Button>
      </>
    );
  }

  return (
    <Workspace
      main={main}
      panelTitle={t.panelTitle}
      onReset={reset}
      resetDisabled={working}
      panel={panel}
      actions={actions}
    />
  );
}

function FileRow({
  row,
  settings,
  working,
  onRemove,
}: {
  row: Row;
  settings: ResizeSettings;
  working: boolean;
  onRemove: () => void;
}) {
  const { file, info, job, result } = row;
  const sizes = info.status === 'ready' ? info.info.pageSizes : [];
  const first = sizes[0];

  let from = '';
  if (first) {
    const names = new Set(sizes.map((s) => matchNamedSize(s) ?? `${s.width}x${s.height}`));
    const named = matchNamedSize(first);
    from =
      names.size > 1
        ? t.mixedSizes
        : named
          ? t.sizeNames[named]
          : `${formatSide(first.width, settings.unit)} × ${formatSide(first.height, settings.unit)} ${settings.unit}`;
  }

  return (
    <li
      data-testid="resize-row"
      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
    >
      <RowThumb file={file.file} size={row.usable ? first : undefined} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{file.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted">
          {row.encrypted && (
            <Badge variant="warn" className="font-sans">
              {t.encrypted}
            </Badge>
          )}
          {info.status === 'reading' && <span>{t.reading}</span>}
          {info.status === 'error' && <span className="text-bad">{t.unreadable}</span>}
          {info.status === 'ready' && !row.encrypted && (
            <>
              <span>{t.pagesCount(info.info.pages)}</span>
              <span>
                {from} <span className="text-accent">→ {t.sizeNames[settings.size]}</span>
              </span>
            </>
          )}
          <span>
            {result
              ? t.bytesChange(formatBytes(file.size), formatBytes(result.blob.size))
              : formatBytes(file.size)}
          </span>
        </span>
        {row.encrypted && <span className="text-xs text-faint">{t.encryptedHelp}</span>}
        {job?.status === 'failed' && job.error && (
          <span className="text-xs text-bad">{job.error}</span>
        )}
      </span>
      <span className="flex items-center gap-1">
        {job?.status === 'waiting' && <span className="text-xs text-faint">{t.waiting}</span>}
        {job?.status === 'working' && (
          <ProgressBar value={job.progress} label={t.progressLabel(file.name)} />
        )}
        {job?.status === 'failed' && <Badge variant="bad">{t.failed}</Badge>}
        {job?.status === 'cancelled' && <Badge>{t.cancelled}</Badge>}
        {result && (
          <>
            <Badge variant="ok">{t.done}</Badge>
            <IconButton
              size="sm"
              label={t.download(result.name)}
              onClick={() => {
                downloadBlob(result.blob, result.name);
                track({ name: 'download', tool: TOOL, kind: 'single' });
              }}
            >
              <Download aria-hidden="true" />
            </IconButton>
          </>
        )}
        <IconButton size="sm" label={t.remove(file.name)} onClick={onRemove} disabled={working}>
          <X aria-hidden="true" />
        </IconButton>
      </span>
    </li>
  );
}
