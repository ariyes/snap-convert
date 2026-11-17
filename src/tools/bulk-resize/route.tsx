// Bulk resize & compress (P17, IMG-08 / IMG-02 / IMG-03 / IMG-09): many images, one set of settings,
// a clear queue with time left, and one ZIP at the end.

import { FolderArchive, FolderDown, LoaderCircle, Play, Plus, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { usePendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import type { ImageJobInput } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import { computePoolSize, readDevice, useQueue } from '@/core/queue';
import { exportStrings, type ExportKind } from '@/features/export';
import {
  FormatSelect,
  imageSettingsSchema,
  MetadataSelect,
  planSize,
  QualitySlider,
  RenamePattern,
  ResizeFields,
} from '@/features/image-settings';
import {
  acceptAttribute,
  DropZone,
  filesFromDataTransfer,
  toIntakeFiles,
  useFileList,
  usePasteTarget,
} from '@/features/intake';
import { useToolSettings } from '@/features/settings';
import { PanelDivider, ToolEmptyState, ToolPage, Workspace } from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { Button, Card, ProgressBar, toast } from '@/ui';
import { withQualityFlag } from '@/tools/_shared';
import { FileRow, type BulkJob } from './file-row';
import { LeaveGuard } from './leave-guard';
import { makeSampleFiles } from './sample-specs';
import {
  BULK_DEFAULTS,
  estimateFileBytes,
  extensionFor,
  jobOptions,
  outputNames,
  plannedFormat,
  settingsSignature,
  type BulkSettings,
  TOOL_ID,
} from './settings';
import { formatBytes, formatTimeLeft, bulkStrings as t } from './strings';
import { useBulkExport } from './use-bulk-export';
import { WindowedList } from './windowed-list';

/** Row height before it's measured (one line of details). */
const ROW_ESTIMATE = 65;

/** The shared queue's actions (read at call time). */
const queue = () => useQueue.getState();

const noSubscribe = () => () => undefined;
const devicePoolSize = () => computePoolSize(readDevice());

function isBulkJob(job: { kind: string; op: string }): job is BulkJob {
  return job.kind === 'image' && job.op === 'process';
}

export default function BulkResizeRoute() {
  const page = useToolPage();
  const accepts = page.accepts;
  const { files, add, remove, clear } = useFileList(TOOL_ID);
  const [settings, save, resetSettings] = useToolSettings<BulkSettings>(
    TOOL_ID,
    BULK_DEFAULTS,
    imageSettingsSchema,
  );
  // Moving the quality slider switches the quality guard off (D28/D29).
  const update = useCallback(
    (patch: Partial<BulkSettings>) => save(withQualityFlag(patch)),
    [save],
  );

  // ---------- Jobs ----------
  const allJobs = useQueue((s) => s.jobs);
  const etaSeconds = useQueue((s) => s.stats.etaSeconds);

  /** File id → id of its job in the shared queue. */
  const [jobIds, setJobIds] = useState<Readonly<Record<string, string>>>({});
  /** Settings key of the last run; results made with another key are stale. */
  const [runSignature, setRunSignature] = useState<string | null>(null);
  /** Job ids already downloaded or saved (no leave warning for those). */
  const [exportedIds, setExportedIds] = useState<ReadonlySet<string>>(() => new Set());

  // Removes this page's jobs (and their result blobs) when the page goes away.
  const jobIdsRef = useRef(jobIds);
  useEffect(() => {
    jobIdsRef.current = jobIds;
  });
  useEffect(
    () => () => {
      for (const id of Object.values(jobIdsRef.current)) queue().remove(id);
    },
    [],
  );

  const jobsById = useMemo(() => {
    const map = new Map<string, BulkJob>();
    for (const job of allJobs) if (isBulkJob(job)) map.set(job.id, job);
    return map;
  }, [allJobs]);

  const busy = Object.values(jobIds).some((id) => {
    const status = jobsById.get(id)?.status;
    return status === 'waiting' || status === 'working';
  });
  // Settings changed after a run: its results are stale. A run that's still going finishes first
  // (with the settings it started with); then it's stale.
  const signature = settingsSignature(settings);
  const stale = !busy && runSignature !== null && runSignature !== signature;

  /** Each file's job with the current settings (none when stale or not run yet). */
  const fileJobs = useMemo(() => {
    const map = new Map<string, BulkJob>();
    if (stale) return map;
    for (const f of files) {
      const id = jobIds[f.id];
      const job = id === undefined ? undefined : jobsById.get(id);
      if (job) map.set(f.id, job);
    }
    return map;
  }, [files, jobIds, jobsById, stale]);

  const myJobs = [...fileJobs.values()];
  const counts = { waiting: 0, working: 0, done: 0, failed: 0, cancelled: 0 };
  for (const job of myJobs) counts[job.status] += 1;
  const running = counts.waiting + counts.working > 0;
  /** Files that still need a run: never run, cancelled, or every file when settings changed. */
  const pending = files.filter((f) => {
    const job = fileJobs.get(f.id);
    return !job || job.status === 'cancelled';
  });
  const phase: 'idle' | 'running' | 'done' = running
    ? 'running'
    : pending.length > 0 || myJobs.length === 0
      ? 'idle'
      : 'done';

  // Output names for finished files, in list order ({n} = position in the list).
  const outNames = useMemo(() => {
    const entries: Array<{ fileId: string; index: number }> = [];
    files.forEach((f, index) => {
      if (fileJobs.get(f.id)?.status === 'done') entries.push({ fileId: f.id, index });
    });
    const names = outputNames(
      settings.rename,
      entries.map(({ fileId, index }) => {
        const file = files[index];
        const result = fileJobs.get(fileId)?.result;
        return {
          name: file?.name ?? '',
          width: result?.width,
          height: result?.height,
          n: index + 1,
          format: result?.format ?? 'jpeg',
        };
      }),
    );
    const map = new Map<string, string>();
    entries.forEach(({ fileId }, i) => map.set(fileId, names[i] ?? ''));
    return map;
  }, [files, fileJobs, settings.rename]);

  // ---------- Device ----------
  const poolSize = useSyncExternalStore(noSubscribe, devicePoolSize, () => 4);

  // ---------- Adding files ----------
  const addFiles = useCallback(
    (incoming: IntakeFile[]) => {
      add(incoming, { accept: accepts });
    },
    [add, accepts],
  );
  const addRaw = useCallback(
    async (raw: File[]) => {
      if (raw.length === 0) return;
      addFiles(await toIntakeFiles(raw));
    },
    [addFiles],
  );
  usePendingFiles(page.id, (raw) => void addRaw(raw));
  usePasteTarget((raw) => void addRaw(raw), files.length > 0 && !running);

  const [sampleBusy, setSampleBusy] = useState(false);
  const onSample = async () => {
    setSampleBusy(true);
    try {
      await addRaw(await makeSampleFiles());
    } catch (error) {
      console.warn('Sample files failed', error);
      toast(t.samplesFailed);
    } finally {
      setSampleBusy(false);
    }
  };

  const pickerRef = useRef<HTMLInputElement>(null);
  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    void addRaw(picked);
  };

  const [dragOver, setDragOver] = useState(false);
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (running || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
    },
    onDrop: (e: DragEvent) => {
      setDragOver(false);
      if (running) return;
      e.preventDefault();
      void filesFromDataTransfer(e.dataTransfer).then(addRaw);
    },
  };

  // ---------- Removing ----------
  const onRemove = useCallback(
    (fileId: string) => {
      const id = jobIdsRef.current[fileId];
      if (id !== undefined) queue().remove(id);
      setJobIds(({ [fileId]: _gone, ...rest }) => rest);
      remove(fileId);
    },
    [remove],
  );

  const onClear = () => {
    for (const id of Object.values(jobIds)) queue().remove(id);
    setJobIds({});
    setRunSignature(null);
    setExportedIds(new Set());
    clear();
  };

  // ---------- Running ----------
  const startRun = () => {
    const targets = stale ? files : pending;
    if (targets.length === 0) return;
    // Old results for these files are replaced.
    for (const f of targets) {
      const old = jobIds[f.id];
      if (old !== undefined) queue().remove(old);
    }
    const options = jobOptions(settings);
    const ids = queue().add<ImageJobInput>(
      'image',
      'process',
      targets.map((f) => ({
        label: f.name,
        input: { ...options, file: f.file, name: f.name, width: f.width, height: f.height },
      })),
    );
    setJobIds((prev) => {
      // When settings changed, jobs of files not in this run are stale too.
      const next: Record<string, string> = stale ? {} : { ...prev };
      targets.forEach((f, i) => {
        const id = ids[i];
        if (id !== undefined) next[f.id] = id;
      });
      return next;
    });
    setRunSignature(signature);
    exportState.reset();
    queue().start();
    track({ name: 'tool-run', tool: TOOL_ID, files: targets.length });
  };

  const onRetry = useCallback((fileId: string) => {
    const id = jobIdsRef.current[fileId];
    if (id !== undefined) queue().retry(id);
  }, []);

  const onCancel = () => {
    // Waiting ones first, so stopping a working job doesn't start the next one.
    for (const status of ['waiting', 'working'] as const) {
      for (const job of myJobs) if (job.status === status) queue().cancel(job.id);
    }
  };

  // ---------- Export ----------
  const doneFiles = files.filter((f) => fileJobs.get(f.id)?.status === 'done');
  const latest = useRef({ doneFiles, fileJobs, outNames });
  useEffect(() => {
    latest.current = { doneFiles, fileJobs, outNames };
  });
  const getExportFiles = useCallback(() => {
    const { doneFiles: done, fileJobs: jobs, outNames: names } = latest.current;
    const out: Array<{ blob: Blob; name: string }> = [];
    for (const f of done) {
      const result = jobs.get(f.id)?.result;
      if (result) out.push({ blob: result.blob, name: names.get(f.id) ?? result.name });
    }
    return out;
  }, []);
  const onExported = useCallback((kind: ExportKind) => {
    const ids = latest.current.doneFiles.map((f) => latest.current.fileJobs.get(f.id)?.id ?? '');
    setExportedIds((prev) => new Set([...prev, ...ids]));
    track({ name: 'download', tool: TOOL_ID, kind });
  }, []);
  const exportState = useBulkExport(getExportFiles, t.zipName, onExported);
  const exporting = exportState.status.kind === 'busy';

  const unsaved = doneFiles.some((f) => {
    const id = fileJobs.get(f.id)?.id;
    return id !== undefined && !exportedIds.has(id);
  });

  // ---------- Summary numbers ----------
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const doneInBytes = doneFiles.reduce((sum, f) => sum + f.size, 0);
  const doneOutBytes = doneFiles.reduce(
    (sum, f) => sum + (fileJobs.get(f.id)?.result?.bytes ?? 0),
    0,
  );
  const runTargets = stale ? files : pending;
  // Only shown before a run (not worked out on every progress tick).
  const estimate = { inBytes: 0, outBytes: 0 };
  if (phase === 'idle') {
    for (const f of runTargets) {
      estimate.inBytes += f.size;
      const source = f.width && f.height ? { width: f.width, height: f.height } : null;
      const plan = source ? planSize(source, settings) : null;
      estimate.outBytes +=
        source && plan
          ? estimateFileBytes(
              { size: f.size, format: plannedFormat('keep', f.name, f.kind) },
              source,
              plan.output,
              plannedFormat(settings.format, f.name, f.kind),
              settings.quality,
            )
          : f.size;
    }
  }
  const finished = counts.done + counts.failed + counts.cancelled;

  // Spoken updates for screen readers: run started / finished.
  const announcement =
    phase === 'running'
      ? t.runStarted(myJobs.length)
      : phase === 'done'
        ? t.runFinished(counts.done, counts.failed)
        : '';

  // ---------- Settings panel ----------
  const panelRef = useRef<HTMLDivElement>(null);
  const focusSettings = () => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')?.focus({
      preventScroll: true,
    });
  };

  const first = files[0];
  const firstSource =
    first?.width && first.height ? { width: first.width, height: first.height } : null;
  const firstPlan = firstSource ? planSize(firstSource, settings) : null;

  // ---------- Render ----------
  const renderRow = (file: IntakeFile, index: number) => (
    <FileRow
      file={file}
      job={fileJobs.get(file.id)}
      resize={settings}
      outName={outNames.get(file.id)}
      removable={!running && !exporting}
      onRemove={onRemove}
      onRetry={onRetry}
      last={index === files.length - 1}
    />
  );

  const primaryAction =
    phase === 'running' ? (
      <Button variant="primary" size="lg" block disabled>
        <LoaderCircle aria-hidden="true" className="animate-spin" />
        {t.working}
      </Button>
    ) : phase === 'done' ? (
      <Button
        variant="primary"
        size="lg"
        block
        disabled={exporting || counts.done === 0}
        onClick={() => void exportState.zip()}
      >
        <FolderArchive aria-hidden="true" />
        {t.downloadZip}
      </Button>
    ) : (
      <Button
        variant="primary"
        size="lg"
        block
        onClick={startRun}
        disabled={runTargets.length === 0}
      >
        <Play aria-hidden="true" />
        {t.run(runTargets.length)}
      </Button>
    );

  const exportStatus = exportState.status;
  const summary = (
    <div
      data-testid="bulk-summary"
      className={cn(
        'sticky bottom-[var(--action-bar-height,0px)] z-[1] flex flex-col gap-2.5 rounded-b-card border-t border-line bg-sunk p-3.5',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {phase === 'running' && (
          <>
            <span>
              {t.processing(Math.max(1, Math.min(poolSize, counts.waiting + counts.working)))}{' '}
              <strong className="tabular-nums">
                {finished}/{myJobs.length}
              </strong>{' '}
              ·{' '}
              <span className="text-muted" data-testid="time-left">
                {formatTimeLeft(etaSeconds)}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <ProgressBar
                value={myJobs.length > 0 ? finished / myJobs.length : 0}
                label={t.overallProgress}
                className="w-[140px] bg-card"
              />
              <Button size="sm" onClick={onCancel} aria-label={t.cancelLabel}>
                {t.cancel}
              </Button>
            </span>
          </>
        )}
        {phase === 'done' && (
          <>
            <span>
              <strong>{t.done(counts.done)}</strong>
              {counts.failed > 0 && (
                <>
                  {' · '}
                  <span className="text-bad">{t.failedCount(counts.failed)}</span>
                </>
              )}
              {' · '}
              <span className="tabular-nums">
                {formatBytes(doneInBytes)} →{' '}
                <strong className="text-ok">{formatBytes(doneOutBytes)}</strong>
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" onClick={focusSettings}>
                {t.changeSettings}
              </Button>
              {exportState.folderSupported && (
                <Button
                  size="sm"
                  onClick={() => void exportState.folder()}
                  disabled={exporting || counts.done === 0}
                  title={exportStrings.saveToFolderHint}
                >
                  <FolderDown aria-hidden="true" />
                  {exportStrings.saveToFolder}
                </Button>
              )}
              {/* On phones the fixed action bar has Download ZIP already. */}
              <Button
                size="sm"
                variant="primary"
                onClick={() => void exportState.zip()}
                disabled={exporting || counts.done === 0}
                className="max-[880px]:hidden"
              >
                <FolderArchive aria-hidden="true" />
                {t.downloadZip}
              </Button>
            </span>
          </>
        )}
        {phase === 'idle' &&
          (stale ? (
            <span className="text-muted">{t.stale}</span>
          ) : (
            <span className="text-muted">
              {t.estimated} {formatBytes(estimate.inBytes)} → {t.about}{' '}
              <strong className="text-fg">{formatBytes(estimate.outBytes)}</strong>
            </span>
          ))}
      </div>
      <div role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
        {exportStatus.kind === 'busy' && (
          <span className="flex flex-col gap-1.5">
            <span>
              {exportStatus.action === 'zip'
                ? exportStrings.zipping(Math.round(exportStatus.progress * 100))
                : exportStrings.saving(Math.round(exportStatus.progress * 100))}
            </span>
            <ProgressBar
              value={exportStatus.progress}
              label={exportStrings.progressLabel}
              size="lg"
            />
          </span>
        )}
        {exportStatus.kind === 'done' && exportStatus.message}
      </div>
      {exportStatus.kind === 'error' && (
        <p role="alert" className="m-0 text-sm text-bad">
          {exportStatus.message}
        </p>
      )}
    </div>
  );

  const main = (
    <Card className={cn('relative', dragOver && 'border-accent')} {...dropProps}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <strong>
          {t.fileCount(files.length)}{' '}
          <span className="font-normal text-muted">· {formatBytes(totalBytes)}</span>
        </strong>
        <span className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => pickerRef.current?.click()}
            disabled={running}
            aria-label={t.addLabel}
          >
            <Plus aria-hidden="true" />
            {t.add}
          </Button>
          <input
            ref={pickerRef}
            type="file"
            multiple
            accept={acceptAttribute(accepts)}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onPicked}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={running || exporting}
            aria-label={t.clearLabel}
          >
            <Trash2 aria-hidden="true" />
            {t.clear}
          </Button>
        </span>
      </div>
      <WindowedList
        aria-label={t.listLabel}
        items={files}
        getKey={(f) => f.id}
        renderItem={renderRow}
        estimateHeight={ROW_ESTIMATE}
      />
      {summary}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </Card>
  );

  const panel = (
    <div ref={panelRef} className="flex scroll-mt-[76px] flex-col gap-4">
      <ResizeFields value={settings} onChange={update} />
      <PanelDivider />
      <div className="flex items-start gap-2.5 *:min-w-0 *:flex-1">
        <FormatSelect value={settings} onChange={update} compact />
        <QualitySlider value={settings} onChange={update} compact className="pt-0.5" />
      </div>
      <RenamePattern
        value={settings}
        onChange={update}
        example={{
          name: first ? first.name.replace(/\.[^.]+$/, '') : 'IMG_2041',
          width: firstPlan?.output.width,
          height: firstPlan?.output.height,
          n: 1,
          format: extensionFor(
            plannedFormat(settings.format, first?.name ?? 'image.jpg', first?.kind ?? 'image'),
          ),
        }}
      />
      <MetadataSelect value={settings} onChange={update} format={settings.format} helper={false} />
    </div>
  );

  return (
    <>
      <ToolPage
        meta={page}
        hasFiles={files.length > 0}
        empty={
          <ToolEmptyState
            dropZone={
              <DropZone
                accept={accepts}
                multiple
                pasteHint
                onFiles={addFiles}
                title={t.dropTitle}
                subtitle={t.dropSubtitle}
              />
            }
            sampleLabel={t.trySamples}
            onSample={() => void onSample()}
            sampleBusy={sampleBusy}
          />
        }
        workspace={
          <Workspace
            main={main}
            panelTitle={t.panelTitle}
            panel={panel}
            onReset={resetSettings}
            resetDisabled={running}
            actions={primaryAction}
          />
        }
      />
      <LeaveGuard reason={running ? 'running' : unsaved ? 'unsaved' : null} />
    </>
  );
}
