// RAW to JPG (P30, RAW-01–03): drop a card's worth of camera RAW files and get crisp JPGs (or PNG,
// WebP, AVIF). Fast mode uses the JPG the camera stored in the file; Full quality develops the RAW
// data. One image job per file through the shared queue, which runs big files alone (D27); the RAW
// engine itself develops one file at a time and halves the size where memory demands it.

import {
  FolderArchive,
  FolderDown,
  LoaderCircle,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
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
import { memoryBudget, RAW_MEMORY } from '@/engines/raw/plan';
import {
  downloadBlob,
  ExportBar,
  exportStrings,
  useExport,
  type ExportKind,
} from '@/features/export';
import {
  FormatSelect,
  MetadataSelect,
  planSize,
  RenamePattern,
  ResizeFields,
  RESIZE_FIELD_MODES,
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
import {
  Field,
  PanelDivider,
  PanelSection,
  ToolEmptyState,
  ToolPage,
  Workspace,
} from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
  Button,
  Card,
  Helper,
  Note,
  ProgressBar,
  RadioCards,
  Segmented,
  Slider,
  toast,
} from '@/ui';
import { WindowedList } from '@/tools/bulk-resize/windowed-list';
import {
  EXTENSIONS,
  formatBytes,
  formatLabels,
  formatTimeLeft,
  outputFileNames,
} from '@/tools/_shared';
import { phoneAdvice, runOutlook, type RawDetails, type RawFileDetails } from './details';
import { FileRow, type RawJob } from './file-row';
import { LeaveGuard } from './leave-guard';
import {
  EXPOSURE,
  formatExposure,
  jobInput,
  QUALITY_MODES,
  RAW_DEFAULTS,
  RAW_FORMATS,
  RAW_SCHEMA,
  settingsSignature,
  TOOL_ID,
  type RawToJpgSettings,
} from './settings';
import { rawToJpgStrings as t } from './strings';
import { closeDetailsWorker, useRawDetails } from './use-raw-details';

/** Row height before it's measured (two lines of details). */
const ROW_ESTIMATE = 65;

/** The sample RAW (CC0, public/samples/raw-sample.cr3; see tests/fixtures/raw/SOURCES.md). */
const SAMPLE_PATH = 'samples/raw-sample.cr3';

/** "Also resize" without "Don't resize" (unticking the box does that). */
const RESIZE_MODES = RESIZE_FIELD_MODES.filter((m) => m !== 'none');

const queue = () => useQueue.getState();
const noSubscribe = () => () => undefined;
const devicePoolSize = () => computePoolSize(readDevice());
/** The RAW engine's memory budget for this device (phones get the smallest). */
const deviceBudget = () => memoryBudget();

function isRawJob(job: { kind: string; op: string }): job is RawJob {
  return job.kind === 'image' && job.op === 'process';
}

/** A file whose details couldn't be read (unsupported or damaged): shown with its error, not run. */
function unreadable(d: RawFileDetails | undefined): boolean {
  return d?.status === 'error' && d.message !== '';
}

export default function RawToJpgRoute() {
  const page = useToolPage();
  const accepts = page.accepts;
  const { files, add, remove, clear } = useFileList(TOOL_ID);
  const [settings, update, resetSettings] = useToolSettings<RawToJpgSettings>(
    TOOL_ID,
    RAW_DEFAULTS,
    RAW_SCHEMA,
  );
  const { details, whenRead } = useRawDetails(files);

  // ---------- Jobs ----------
  const allJobs = useQueue((s) => s.jobs);
  const etaSeconds = useQueue((s) => s.stats.etaSeconds);
  /** File id → its job in the shared queue. */
  const [jobIds, setJobIds] = useState<Readonly<Record<string, string>>>({});
  const [runSignature, setRunSignature] = useState<string | null>(null);
  const [exportedIds, setExportedIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Run asked for while some files are still being read: starts once they are. */
  const [preparing, setPreparing] = useState(false);
  /** Bumped by Cancel and Clear, so a run still waiting for files to be read doesn't start. */
  const runToken = useRef(0);

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
    const map = new Map<string, RawJob>();
    for (const job of allJobs) if (isRawJob(job)) map.set(job.id, job);
    return map;
  }, [allJobs]);

  const busy = Object.values(jobIds).some((id) => {
    const status = jobsById.get(id)?.status;
    return status === 'waiting' || status === 'working';
  });
  const signature = settingsSignature(settings);
  const stale = !busy && runSignature !== null && runSignature !== signature;

  const fileJobs = useMemo(() => {
    const map = new Map<string, RawJob>();
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
  const runnable = files.filter((f) => !unreadable(details.get(f.id)));
  const pending = runnable.filter((f) => {
    const job = fileJobs.get(f.id);
    return !job || job.status === 'cancelled';
  });
  const runTargets = stale ? runnable : pending;
  const phase: 'idle' | 'running' | 'done' =
    running || preparing
      ? 'running'
      : runTargets.length > 0 || myJobs.length === 0
        ? 'idle'
        : 'done';

  // Output names for finished files, in list order ({n} = position in the list).
  const outNames = useMemo(() => {
    const entries: Array<{ fileId: string; index: number }> = [];
    files.forEach((f, index) => {
      if (fileJobs.get(f.id)?.status === 'done') entries.push({ fileId: f.id, index });
    });
    const names = outputFileNames(
      entries.map(({ fileId, index }) => {
        const result = fileJobs.get(fileId)?.result;
        return {
          fileName: files[index]?.name ?? '',
          n: index + 1,
          width: result?.width ?? 0,
          height: result?.height ?? 0,
          format: result?.format ?? settings.format,
        };
      }),
      settings.rename,
    );
    const map = new Map<string, string>();
    entries.forEach(({ fileId }, i) => map.set(fileId, names[i] ?? ''));
    return map;
  }, [files, fileJobs, settings.rename, settings.format]);

  // ---------- Device ----------
  const poolSize = useSyncExternalStore(noSubscribe, devicePoolSize, () => 4);
  const budget = useSyncExternalStore(noSubscribe, deviceBudget, () => RAW_MEMORY.desktopBudget);
  const phone = budget <= RAW_MEMORY.phoneBudget;

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
      const response = await fetch(`${import.meta.env.BASE_URL}${SAMPLE_PATH}`);
      if (!response.ok) throw new Error(`Sample: ${response.status}`);
      const blob = await response.blob();
      await addRaw([new File([blob], t.sampleName, { lastModified: 0 })]);
    } catch (error) {
      console.warn('Sample RAW failed', error);
      toast(t.sampleFailed);
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
    runToken.current += 1;
    setPreparing(false);
    clear();
  };

  // ---------- Export ----------
  const doneFiles = files.filter((f) => fileJobs.get(f.id)?.status === 'done');
  const exportFiles = useMemo(() => {
    const out: Array<{ blob: Blob; name: string }> = [];
    for (const f of doneFiles) {
      const result = fileJobs.get(f.id)?.result;
      if (result) out.push({ blob: result.blob, name: outNames.get(f.id) ?? result.name });
    }
    return out;
  }, [doneFiles, fileJobs, outNames]);
  const latest = useRef({ exportFiles, doneFiles, fileJobs });
  useEffect(() => {
    latest.current = { exportFiles, doneFiles, fileJobs };
  });
  const getExportFiles = useCallback(() => latest.current.exportFiles, []);
  const onExported = useCallback((kind: ExportKind) => {
    const ids = latest.current.doneFiles.map((f) => latest.current.fileJobs.get(f.id)?.id ?? '');
    setExportedIds((prev) => new Set([...prev, ...ids]));
    track({ name: 'download', tool: TOOL_ID, kind });
  }, []);
  const exportState = useExport(getExportFiles, t.zipName, onExported);
  const exporting = exportState.status.kind === 'busy';

  const onDownload = useCallback(
    (fileId: string) => {
      const job = fileJobs.get(fileId);
      if (!job?.result) return;
      downloadBlob(job.result.blob, outNames.get(fileId) ?? job.result.name);
      setExportedIds((prev) => new Set([...prev, job.id]));
      track({ name: 'download', tool: TOOL_ID, kind: 'single' });
    },
    [fileJobs, outNames],
  );

  const unsaved = doneFiles.some((f) => {
    const id = fileJobs.get(f.id)?.id;
    return id !== undefined && !exportedIds.has(id);
  });

  // ---------- Running ----------
  const sizeOf = (d: RawFileDetails | undefined) =>
    d?.status === 'ready' ? { width: d.width, height: d.height } : undefined;

  /** Adds one job per file (still listed and readable) and starts the queue. */
  const launch = (fileIds: readonly string[]) => {
    const targets = files.filter((f) => fileIds.includes(f.id) && !unreadable(details.get(f.id)));
    if (targets.length === 0) return;
    // The page's own RAW reader isn't needed any more: give its memory to the run.
    void closeDetailsWorker();
    for (const f of targets) {
      const old = jobIds[f.id];
      if (old !== undefined) queue().remove(old);
    }
    const ids = queue().add<ImageJobInput>(
      'image',
      'process',
      targets.map((f) => ({
        label: f.name,
        input: jobInput(settings, f.file, sizeOf(details.get(f.id))),
      })),
    );
    setJobIds((prev) => {
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
  const launchRef = useRef(launch);
  useEffect(() => {
    launchRef.current = launch;
  });

  // Every file's size goes with its job (D27), so a run waits until each file has been read.
  const startRun = async () => {
    const ids = runTargets.map((f) => f.id);
    if (ids.length === 0) return;
    if (ids.every((id) => details.has(id))) {
      launch(ids);
      return;
    }
    const token = ++runToken.current;
    setPreparing(true);
    await whenRead(ids);
    if (token !== runToken.current) return;
    setPreparing(false);
    launchRef.current(ids);
  };

  const onRetry = useCallback((fileId: string) => {
    const id = jobIdsRef.current[fileId];
    if (id !== undefined) queue().retry(id);
  }, []);

  const onCancel = () => {
    runToken.current += 1;
    setPreparing(false);
    for (const status of ['waiting', 'working'] as const) {
      for (const job of myJobs) if (job.status === status) queue().cancel(job.id);
    }
  };

  // ---------- Summary numbers ----------
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const doneInBytes = doneFiles.reduce((sum, f) => sum + f.size, 0);
  const doneOutBytes = doneFiles.reduce(
    (sum, f) => sum + (fileJobs.get(f.id)?.result?.bytes ?? 0),
    0,
  );
  const finished = counts.done + counts.failed + counts.cancelled;

  // What the next run will do on this device (camera JPEGs, develops, half size for memory).
  const readTargets: Array<{ details: RawDetails; bytes: number }> = [];
  for (const f of runTargets) {
    const d = details.get(f.id);
    if (d?.status === 'ready') readTargets.push({ details: d, bytes: f.size });
  }
  const outlook = runOutlook(readTargets, settings.mode, budget, (d) => {
    if (!settings.resizeEnabled) return undefined;
    const plan = planSize({ width: d.width, height: d.height }, settings);
    return plan ? Math.max(plan.output.width, plan.output.height) : undefined;
  });
  const advice = phase === 'idle' ? phoneAdvice(outlook, phone) : null;
  const noCameraJpeg =
    settings.mode === 'fast' ? readTargets.filter((r) => !r.details.cameraJpeg).length : 0;

  const announcement =
    phase === 'running'
      ? t.runStarted(myJobs.length || runTargets.length)
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
  const firstDetails = first ? details.get(first.id) : undefined;
  const firstSize = sizeOf(firstDetails);
  const firstPlan = firstSize && settings.resizeEnabled ? planSize(firstSize, settings) : null;
  const formatName = formatLabels[settings.format];
  const locked = running || preparing;

  // ---------- Render ----------
  const renderRow = (file: IntakeFile, index: number) => (
    <FileRow
      file={file}
      details={details.get(file.id)}
      job={fileJobs.get(file.id)}
      resize={settings}
      fastMode={settings.mode === 'fast'}
      outName={outNames.get(file.id)}
      phone={phone}
      removable={!locked && !exporting}
      onRemove={onRemove}
      onRetry={onRetry}
      onDownload={onDownload}
      last={index === files.length - 1}
    />
  );

  const primaryAction =
    phase === 'running' ? (
      <Button variant="primary" size="lg" block disabled>
        <LoaderCircle aria-hidden="true" className="animate-spin" />
        {preparing ? t.preparing : t.working}
      </Button>
    ) : phase === 'done' ? (
      <ExportBar
        variant="panel"
        state={exportState}
        files={exportFiles}
        zipOnly={exportFiles.length > 1}
        zipLabel={t.downloadZip}
        folder="never"
        showStatus={false}
      />
    ) : (
      <Button
        variant="primary"
        size="lg"
        block
        onClick={() => void startRun()}
        disabled={runTargets.length === 0}
      >
        <Play aria-hidden="true" />
        {t.run(runTargets.length, formatName)}
      </Button>
    );

  const exportStatus = exportState.status;
  const summary = (
    <div
      data-testid="raw-summary"
      className="sticky bottom-[var(--action-bar-height,0px)] z-[1] flex flex-col gap-2.5 rounded-b-card border-t border-line bg-sunk p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {phase === 'running' && (
          <>
            <span>
              {preparing ? (
                t.preparing
              ) : (
                <>
                  {t.processing(Math.max(1, Math.min(poolSize, counts.waiting + counts.working)))}{' '}
                  <strong className="tabular-nums">
                    {finished}/{myJobs.length}
                  </strong>{' '}
                  ·{' '}
                  <span className="text-muted" data-testid="time-left">
                    {formatTimeLeft(etaSeconds)}
                  </span>
                </>
              )}
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
              {exportFiles.length > 1 && (
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
              )}
            </span>
          </>
        )}
        {phase === 'idle' && (
          <span className="text-muted">{stale ? t.stale : t.ready(runTargets.length)}</span>
        )}
      </div>
      {advice && (
        <Note icon={TriangleAlert} data-testid="phone-advice" className="bg-card">
          {advice === 'half-size' ? t.phoneHalfSize(outlook.halfSize) : t.phoneSlow}
        </Note>
      )}
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
            disabled={locked}
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
            disabled={locked || exporting}
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
      <PanelSection>
        <Field>
          <span className="text-ui font-medium text-muted">{t.qualityModeLabel}</span>
          <RadioCards
            label={t.qualityModeLabel}
            value={settings.mode}
            onValueChange={(mode) => update({ mode })}
            options={(['fast', 'full'] as const).map((mode) => ({
              value: mode,
              title: t.modes[mode].title,
              description: t.modes[mode].description,
            }))}
          />
          {noCameraJpeg > 0 && (
            <Helper data-testid="no-camera-jpeg">
              {t.fastNoJpeg(noCameraJpeg, readTargets.length)}
            </Helper>
          )}
        </Field>
        {settings.mode === 'full' && (
          <>
            <Field>
              <span className="text-ui font-medium text-muted">{t.whiteBalance}</span>
              <Segmented
                label={t.whiteBalance}
                value={settings.whiteBalance}
                onValueChange={(whiteBalance) => update({ whiteBalance })}
                options={(['as-shot', 'auto'] as const).map((wb) => ({
                  value: wb,
                  label: t.whiteBalanceModes[wb],
                }))}
              />
              <Helper>{t.whiteBalanceHelp[settings.whiteBalance]}</Helper>
            </Field>
            <Slider
              label={t.exposure}
              helper={t.exposureHelp}
              value={settings.exposure}
              min={EXPOSURE.min}
              max={EXPOSURE.max}
              step={EXPOSURE.step}
              formatValue={formatExposure}
              onValueChange={(exposure) => update({ exposure })}
            />
            <Field>
              <span className="text-ui font-medium text-muted">{t.highlights}</span>
              <Segmented
                label={t.highlights}
                value={settings.highlights}
                onValueChange={(highlights) => update({ highlights })}
                options={(['clip', 'recover'] as const).map((h) => ({
                  value: h,
                  label: t.highlightModes[h],
                }))}
              />
              <Helper>{t.highlightHelp[settings.highlights]}</Helper>
            </Field>
          </>
        )}
      </PanelSection>
      <PanelDivider />
      <FormatSelect
        value={settings}
        onChange={(patch) => {
          if (patch.format !== 'keep') update({ format: patch.format });
        }}
        formats={RAW_FORMATS}
      />
      {settings.format === 'png' ? (
        <Helper>{t.pngHelp}</Helper>
      ) : (
        <PanelSection>
          <Field>
            <span className="text-ui font-medium text-muted">{t.quality}</span>
            <Segmented
              label={t.quality}
              value={settings.qualityMode}
              onValueChange={(qualityMode) => update({ qualityMode })}
              options={QUALITY_MODES.map((mode) => ({ value: mode, label: t.qualityModes[mode] }))}
            />
            {settings.qualityMode === 'auto' && <Helper>{t.qualityAutoHelp}</Helper>}
          </Field>
          {settings.qualityMode === 'custom' && (
            <Slider
              label={t.qualityLevel}
              helper={t.qualityHelp}
              value={settings.quality}
              min={10}
              max={100}
              onValueChange={(quality) => update({ quality })}
            />
          )}
        </PanelSection>
      )}
      <PanelDivider />
      <ResizeFields value={settings} onChange={update} optional modes={RESIZE_MODES} />
      <RenamePattern
        value={settings}
        onChange={update}
        example={{
          name: first ? first.name.replace(/\.[^.]+$/, '') : 'IMG_2041',
          width: firstPlan?.output.width ?? firstSize?.width,
          height: firstPlan?.output.height ?? firstSize?.height,
          n: 1,
          format: EXTENSIONS[settings.format],
        }}
      />
      <MetadataSelect value={settings} onChange={update} format={settings.format} />
    </div>
  );

  return (
    <>
      <ToolPage
        meta={page}
        description={t.description}
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
            sampleLabel={t.trySample}
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
            resetDisabled={locked}
            actions={primaryAction}
          />
        }
      />
      <LeaveGuard reason={locked ? 'running' : unsaved ? 'unsaved' : null} />
    </>
  );
}
