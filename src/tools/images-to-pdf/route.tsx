// Images to PDF (P18, PDF-01): photos or scans → one PDF, one fitted page per image, in the
// user's order. Images are made PDF-ready by the image worker when needed (HEIC, WebP, AVIF,
// GIF, BMP, or "Smaller file"), then the PDF worker builds the document — both via the queue.
import { CircleAlert, Download, FileCheck2, FileImage, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { IntakeFile } from '@/core/contracts/intake';
import type { PageOrientation, PdfOutput } from '@/core/contracts/pdf';
import { useQueue } from '@/core/queue';
import { usePendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import { downloadBlob, safeFileName } from '@/features/export';
import { DropZone, toIntakeFiles, useFileList } from '@/features/intake';
import { useToolSettings } from '@/features/settings';
import {
  Field,
  PanelDivider,
  PanelSection,
  ResponsiveLabel,
  ToolEmptyState,
  ToolPage,
  Workspace,
} from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
  Button,
  Helper,
  inputClass,
  Label,
  Note,
  ProgressBar,
  RadioCards,
  Segmented,
  Select,
} from '@/ui';
import { buildPdf, ConversionCache, ImageFailed } from './build';
import { formatBytes } from './format';
import { PageGrid } from './page-grid';
import { JobCancelled } from './queue-job';
import {
  defaultSettings,
  MARGIN_CHOICES,
  MARGIN_MM,
  ORIENTATIONS,
  PAGE_SIZE_CHOICES,
  QUALITY_CHOICES,
  settingsSchema,
  TOOL_ID,
  type ImagesToPdfSettings,
} from './settings';
import { strings } from './strings';

type Run =
  | { status: 'idle' }
  | { status: 'working'; progress: number }
  | { status: 'done'; output: PdfOutput; before: number; signature: string }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' };

/** Identifies what a PDF was made from, so a change makes the result out of date. */
function signatureOf(files: readonly IntakeFile[], s: ImagesToPdfSettings, name: string): string {
  return JSON.stringify([files.map((f) => f.id), s, name]);
}

export default function ImagesToPdfRoute() {
  const page = useToolPage();
  const { files, add, remove, clear, reorder } = useFileList(TOOL_ID);
  const [defaults] = useState(() => defaultSettings());
  const [settings, update, reset] = useToolSettings(TOOL_ID, defaults, settingsSchema);
  const [name, setName] = useState('');
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewBusy, setPreviewBusy] = useState<ReadonlySet<string>>(() => new Set());
  const nameId = useId();
  const pageSizeId = useId();

  const [cache] = useState(() => new ConversionCache(useQueue));
  /** Preview jobs (HEIC) and build jobs this page started that may still be running. */
  const previewJobs = useRef(new Set<string>());
  const buildJobs = useRef(new Set<string>());
  const abort = useRef<AbortController | null>(null);
  /** One per mount: late results from an earlier mount (or after leaving) are ignored. */
  const life = useRef({ alive: false });
  const startedPreviews = useRef(new Set<string>());
  /** Preview URLs made here, revoked when their file goes or the page closes. */
  const previewUrls = useRef(new Map<string, string>());

  const accept = page.accepts;
  usePendingFiles(page.id, (raw) => {
    void toIntakeFiles(raw).then((list) => add(list, { accept }));
  });

  const options = useMemo(
    () => ({
      pageSize: settings.pageSize,
      orientation: settings.orientation,
      marginMm: MARGIN_MM[settings.margin],
    }),
    [settings.pageSize, settings.orientation, settings.margin],
  );

  /** Stops the PDF being built (if any). */
  const stopBuild = useCallback(() => {
    abort.current?.abort();
    const queue = useQueue.getState();
    for (const id of buildJobs.current) queue.cancel(id);
    buildJobs.current.clear();
  }, []);

  // Leaving the page stops this page's work and frees the preview images.
  useEffect(() => {
    const current = { alive: true };
    life.current = current;
    const started = startedPreviews.current;
    const previewing = previewJobs.current;
    const urls = previewUrls.current;
    return () => {
      current.alive = false;
      stopBuild();
      const queue = useQueue.getState();
      for (const id of previewing) queue.cancel(id);
      previewing.clear();
      cache.clear();
      started.clear();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [stopBuild, cache]);

  // HEIC files have no browser preview: convert them now (Original quality reuses the result).
  useEffect(() => {
    const mine = life.current;
    for (const file of files) {
      if (file.kind !== 'heic' || file.thumbUrl || file.error) continue;
      if (startedPreviews.current.has(file.id)) continue;
      startedPreviews.current.add(file.id);
      setPreviewBusy((s) => new Set(s).add(file.id));
      void (async () => {
        let jobId: string | null = null;
        try {
          const started = await cache.ensure(file, 'original');
          jobId = started.jobId;
          if (jobId) previewJobs.current.add(jobId);
          const blob = await started.promise;
          if (!mine.alive || !startedPreviews.current.has(file.id)) return;
          const url = URL.createObjectURL(blob);
          previewUrls.current.set(file.id, url);
          setPreviews((p) => ({ ...p, [file.id]: url }));
        } catch (error) {
          if (!mine.alive || error instanceof JobCancelled) return;
          const reason = error instanceof Error ? error.message : '';
          setErrors((e) => ({ ...e, [file.id]: strings.convertFailed(file.name, reason) }));
        } finally {
          if (jobId) previewJobs.current.delete(jobId);
          if (mine.alive) {
            setPreviewBusy((s) => {
              const next = new Set(s);
              next.delete(file.id);
              return next;
            });
          }
        }
      })();
    }
  }, [files, cache]);

  const forget = (id: string) => {
    cache.forget(id);
    startedPreviews.current.delete(id);
    const url = previewUrls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previewUrls.current.delete(id);
    setPreviews(({ [id]: _, ...rest }) => rest);
    setErrors(({ [id]: _, ...rest }) => rest);
  };

  const removeFile = (id: string) => {
    forget(id);
    remove(id);
  };

  const clearAll = () => {
    stopBuild();
    const queue = useQueue.getState();
    for (const id of previewJobs.current) queue.cancel(id);
    previewJobs.current.clear();
    for (const f of files) forget(f.id);
    clear();
    setRun({ status: 'idle' });
  };

  const outName = `${name.trim() || strings.defaultName}.pdf`;
  const signature = signatureOf(files, settings, outName);
  const working = run.status === 'working';
  const done = run.status === 'done' && run.signature === signature;
  const hasErrors = files.some((f) => errors[f.id] ?? f.error);

  const make = async () => {
    if (working || files.length === 0) return;
    const controller = new AbortController();
    abort.current = controller;
    const list = [...files];
    const sig = signature;
    const mine = life.current;
    setRun({ status: 'working', progress: 0 });
    track({ name: 'tool-run', tool: TOOL_ID, files: list.length });
    try {
      const output = await buildPdf({
        files: list,
        settings,
        outName,
        queue: useQueue,
        cache,
        signal: controller.signal,
        onJob: (id) => buildJobs.current.add(id),
        onProgress: (progress) => {
          if (mine.alive && !controller.signal.aborted) setRun({ status: 'working', progress });
        },
      });
      if (!mine.alive) return;
      const before = list.reduce((n, f) => n + f.size, 0);
      setRun({ status: 'done', output, before, signature: sig });
    } catch (error) {
      if (!mine.alive) return;
      stopBuild();
      if (error instanceof JobCancelled) {
        setRun({ status: 'cancelled' });
        return;
      }
      if (error instanceof ImageFailed) {
        const file = list.find((f) => f.id === error.fileId);
        const message = strings.convertFailed(file?.name ?? '', error.message);
        setErrors((e) => ({ ...e, [error.fileId]: message }));
        setRun({ status: 'failed', message: `${message}. ${strings.fixFiles}` });
        return;
      }
      setRun({ status: 'failed', message: error instanceof Error ? error.message : strings.noPdf });
    } finally {
      if (abort.current === controller) abort.current = null;
      buildJobs.current.clear();
    }
  };

  const download = () => {
    if (run.status !== 'done') return;
    downloadBlob(run.output.blob, safeFileName(run.output.name, strings.defaultName));
    track({ name: 'download', tool: TOOL_ID, kind: 'single' });
  };

  const dropZone = (
    <DropZone
      accept={accept}
      multiple
      pasteHint
      onFiles={(list) => add(list)}
      title={strings.dropTitle}
      subtitle={strings.dropSubtitle}
    />
  );

  const addTile = (
    <DropZone
      accept={accept}
      multiple
      size="small"
      onFiles={(list) => add(list)}
      title={strings.addMore}
      subtitle={strings.addMoreSubtitle}
      disabled={working}
      className="min-h-[180px] justify-center gap-1.5 rounded-[10px] px-3 py-4 [&>span:first-child]:size-10 [&>span:nth-child(2)]:text-sm"
    />
  );

  const fitImage = settings.pageSize === 'fit-image';

  const panel = (
    <>
      <PanelSection>
        <Field>
          <Label htmlFor={pageSizeId}>{strings.pageSize}</Label>
          <Select
            id={pageSizeId}
            value={settings.pageSize}
            onValueChange={(pageSize) => update({ pageSize })}
            disabled={working}
            options={PAGE_SIZE_CHOICES.map((value) => ({
              value,
              label: strings.pageSizes[value],
            }))}
          />
          <Helper>{strings.pageSizeHelp[settings.pageSize]}</Helper>
        </Field>
        <Field>
          <span className="text-ui font-medium text-muted">{strings.orientation}</span>
          <Segmented<PageOrientation>
            label={strings.orientation}
            value={settings.orientation}
            onValueChange={(orientation) => update({ orientation })}
            disabled={working || fitImage}
            options={ORIENTATIONS.map((value) => ({
              value,
              label: strings.orientations[value],
            }))}
          />
          <Helper>{fitImage ? strings.orientationFitImage : strings.orientationHelp}</Helper>
        </Field>
        <Field>
          <span className="text-ui font-medium text-muted">{strings.margin}</span>
          <Segmented
            label={strings.margin}
            value={settings.margin}
            onValueChange={(margin) => update({ margin })}
            disabled={working}
            options={MARGIN_CHOICES.map((value) => ({ value, label: strings.margins[value] }))}
          />
          <Helper>{strings.marginHelp}</Helper>
        </Field>
      </PanelSection>
      <PanelDivider />
      <PanelSection>
        <span className="text-ui font-medium text-muted">{strings.quality}</span>
        <RadioCards
          label={strings.quality}
          value={settings.quality}
          onValueChange={(quality) => update({ quality })}
          disabled={working}
          options={QUALITY_CHOICES.map((value) => ({
            value,
            title: strings.qualities[value],
            description: strings.qualityHelp[value],
          }))}
        />
      </PanelSection>
      <PanelDivider />
      <Field>
        <Label htmlFor={nameId}>{strings.fileName}</Label>
        <span className="relative flex">
          <input
            id={nameId}
            className={cn(inputClass, 'pr-12')}
            value={name}
            placeholder={strings.defaultName}
            spellCheck={false}
            autoComplete="off"
            maxLength={120}
            disabled={working}
            onChange={(e) => setName(e.target.value)}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-ui text-faint"
          >
            .pdf
          </span>
        </span>
      </Field>
      <Note>{strings.neverStretched}</Note>
      <Status run={run} done={done} />
    </>
  );

  const actions = working ? (
    <>
      <Button variant="primary" size="lg" block disabled>
        <LoaderCircle aria-hidden="true" className="animate-spin" />
        {strings.making}
      </Button>
      <Button size="lg" block onClick={stopBuild}>
        <X aria-hidden="true" />
        {strings.cancel}
      </Button>
    </>
  ) : done ? (
    <Button variant="primary" size="lg" block onClick={download}>
      <Download aria-hidden="true" />
      {strings.downloadPdf}
    </Button>
  ) : (
    <Button
      variant="primary"
      size="lg"
      block
      onClick={() => void make()}
      disabled={files.length === 0 || hasErrors}
    >
      <FileImage aria-hidden="true" />
      <ResponsiveLabel wide={strings.make(files.length)} narrow={strings.makeShort} />
    </Button>
  );

  return (
    <ToolPage
      meta={page}
      hasFiles={files.length > 0}
      empty={<ToolEmptyState dropZone={dropZone} />}
      workspace={
        <Workspace
          main={
            <PageGrid
              files={files}
              options={options}
              previews={previews}
              previewBusy={previewBusy}
              errors={errors}
              onMove={reorder}
              onRemove={removeFile}
              onClear={clearAll}
              addTile={addTile}
              disabled={working}
            />
          }
          panelTitle={strings.panelTitle}
          onReset={reset}
          resetDisabled={working}
          panel={panel}
          actions={actions}
        />
      }
    />
  );
}

function Status({ run, done }: { run: Run; done: boolean }) {
  if (run.status === 'working') {
    const percent = Math.round(run.progress * 100);
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-ui font-medium text-muted">{strings.makingPercent(percent)}</span>
        <ProgressBar value={run.progress} label={strings.progressLabel} size="lg" />
      </div>
    );
  }
  if (run.status === 'done' && done) {
    return (
      <div
        role="status"
        data-testid="pdf-result"
        className="flex items-center gap-3.5 rounded-card bg-ok-bg p-4 text-ok"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-card">
          <FileCheck2 aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-fg">{run.output.name}</strong>
          <span className="block text-ui">
            {strings.resultDetail(run.output.pages, formatBytes(run.output.blob.size))}
          </span>
          <span className="block text-xs">
            {strings.resultBefore(formatBytes(run.before), formatBytes(run.output.blob.size))}
          </span>
        </span>
      </div>
    );
  }
  if (run.status === 'failed') {
    return (
      <p role="alert" className="m-0 flex items-start gap-2 text-sm text-bad">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {run.message}
      </p>
    );
  }
  if (run.status === 'cancelled') {
    return (
      <p role="status" className="m-0 text-sm text-muted">
        {strings.cancelled}
      </p>
    );
  }
  return null;
}
