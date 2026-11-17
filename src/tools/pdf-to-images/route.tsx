// PDF to images (P31, PDF-06): every page, or the pages picked, saved as JPG or PNG at a chosen DPI.
// Pages are drawn with pdf.js (2 at a time across the app) and encoded in the image worker.
import {
  Check,
  CircleAlert,
  Download,
  FileImage,
  FileUp,
  Images,
  LoaderCircle,
  Lock,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { usePendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import type { IntakeFile } from '@/core/contracts/intake';
import { useQueue } from '@/core/queue';
import { MAX_CONCURRENT_RENDERS, PAGE_IMAGE_LIMITS, pageImageSize } from '@/engines/pdf/render';
import { downloadBlob, ExportBar, uniqueNames } from '@/features/export';
import {
  acceptAttribute,
  DropZone,
  keepAccepted,
  toIntakeFiles,
  useFileList,
  usePasteTarget,
} from '@/features/intake';
import { useToolSettings } from '@/features/settings';
import { Field, PanelSection, ToolEmptyState, ToolPage, Workspace } from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
  Button,
  Card,
  Helper,
  HelpTip,
  IconButton,
  Input,
  Label,
  NumberField,
  ProgressBar,
  Segmented,
  Slider,
  toast,
} from '@/ui';
import { baseName, formatBytes } from '@/tools/_shared';
import {
  INFO_LOADING,
  PdfPageThumb,
  samplePdfFile,
  SPLIT_SAMPLE,
  useFileDrop,
  usePdfInfos,
} from '@/tools/_shared/pdf';
import { togglePage } from '@/tools/split-pdf/plan';
import { PageRunner, runStats, type PageTask } from './runner';
import {
  DEFAULTS,
  dpiOf,
  MAX_PATTERN_LENGTH,
  PAGE_FORMATS,
  pageFileName,
  planPages,
  QUALITY_LIMITS,
  QUALITY_MODES,
  RESOLUTIONS,
  SCHEMA,
  TOOL_ID,
  type PageMode,
  type PagePlan,
  type PdfToImagesSettings,
} from './settings';
import { pdfToImagesStrings as t } from './strings';
import { describePageError, pageWork, type PageOutput } from './work';

const PDF_ONLY = ['pdf'] as const;
/** Page thumbnail long side, CSS px. */
const THUMB_SIZE = 140;
/** Pages drawn or being encoded at once: the 2 render slots plus a little encoding headroom. */
const PAGES_IN_FLIGHT = MAX_CONCURRENT_RENDERS + 2;

type Task = PageTask<PageOutput>;

/** Settings that change the images (a new name pattern only renames them). */
const IMAGE_KEYS: ReadonlyArray<keyof PdfToImagesSettings> = [
  'format',
  'resolution',
  'customDpi',
  'qualityMode',
  'quality',
];

export default function PdfToImagesRoute() {
  const page = useToolPage();
  const { files, add, clear } = useFileList(TOOL_ID);
  const current = files[0];
  const currentList = useMemo(() => (current ? [current] : []), [current]);
  const infos = usePdfInfos(currentList);
  const info = (current && infos.get(current.file)) ?? INFO_LOADING;
  const [settings, update, reset] = useToolSettings(TOOL_ID, DEFAULTS, SCHEMA);
  const [pageMode, setPageMode] = useState<PageMode>('all');
  const [ranges, setRangesText] = useState('');
  const [rangesTouched, setRangesTouched] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);

  // The current run: one runner per run, its pages, and a number that names the run.
  const runner = useRef<PageRunner<PageOutput> | null>(null);
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [runId, setRunId] = useState(0);
  const stats = runStats(tasks);
  const working = stats.running;

  const pageCount = info.status === 'ready' ? info.info.pages : 0;
  // Locked: the PDF needs a password to open. (An owner password only limits editing; such PDFs
  // open and are drawn like any other.)
  const locked = info.status === 'ready' && info.info.encrypted && pageCount === 0;
  const ready = info.status === 'ready' && !locked && pageCount > 0;
  const plan = useMemo(() => planPages(pageMode, ranges, pageCount), [pageMode, ranges, pageCount]);
  const canRun = ready && plan.ok && plan.pages.length > 0 && !working;
  const dpi = dpiOf(settings);
  const formatName = t.formats[settings.format];

  const discard = () => {
    runner.current?.dispose();
    runner.current = null;
    setTasks([]);
  };
  // Leaving the page cancels drawing and encoding.
  useEffect(() => () => runner.current?.dispose(), []);

  const change = (patch: Partial<PdfToImagesSettings>) => {
    update(patch);
    if (IMAGE_KEYS.some((key) => key in patch)) discard();
  };
  const setMode = (mode: PageMode) => {
    setPageMode(mode);
    discard();
  };
  const setRanges = (text: string) => {
    setRangesText(text);
    setRangesTouched(true);
    discard();
  };
  const resetPages = () => {
    setPageMode('all');
    setRangesText('');
    setRangesTouched(false);
  };

  const setFile = (incoming: IntakeFile[]) => {
    const [pdf] = keepAccepted(incoming, PDF_ONLY);
    if (!pdf) return;
    discard();
    clear();
    add([pdf]);
    resetPages();
  };
  const setRaw = async (raw: File[]) => setFile(await toIntakeFiles(raw.slice(0, 1)));
  usePendingFiles(page.id, (raw) => void setRaw(raw));

  const removeFile = () => {
    discard();
    clear();
    resetPages();
  };

  const trySample = async () => {
    setSampleBusy(true);
    try {
      setFile(await toIntakeFiles([samplePdfFile(SPLIT_SAMPLE)]));
    } finally {
      setSampleBusy(false);
    }
  };

  const clickPage = (pageNumber: number) => {
    if (working) return;
    if (pageMode !== 'choose') setPageMode('choose');
    setRanges(togglePage(ranges, pageNumber, pageCount));
  };

  const run = () => {
    if (!canRun || !current) return;
    discard();
    const next = new PageRunner<PageOutput>(
      pageWork({
        file: current.file,
        pdfName: current.name,
        dpi,
        settings: {
          format: settings.format,
          qualityMode: settings.qualityMode,
          quality: settings.quality,
        },
        queue: useQueue,
      }),
      { concurrency: PAGES_IN_FLIGHT, describeError: describePageError },
    );
    runner.current = next;
    next.subscribe(setTasks);
    setRunId((id) => id + 1);
    next.start(plan.pages);
    track({ name: 'tool-run', tool: TOOL_ID, files: 1 });
  };

  // Output names: the pattern for each saved page, unique within the run.
  const outputs = useMemo(() => {
    if (!current) return [];
    const done = tasks.flatMap((task) => (task.status === 'done' && task.result ? [task] : []));
    const names = uniqueNames(
      done.map((task) =>
        pageFileName(settings.rename, {
          pdfName: current.name,
          page: task.page,
          pageCount,
          width: task.result!.width,
          height: task.result!.height,
          format: task.result!.format === 'png' ? 'png' : 'jpeg',
        }),
      ),
    );
    return done.map((task, i) => ({ page: task.page, name: names[i]!, output: task.result! }));
  }, [tasks, settings.rename, current, pageCount]);
  const nameOf = useMemo(() => new Map(outputs.map((o) => [o.page, o.name])), [outputs]);
  const exportFiles = useMemo(
    () => outputs.map(({ output, name }) => ({ blob: output.blob, name })),
    [outputs],
  );
  const zipName = `${baseName(current?.name ?? 'document')}${t.zipSuffix}`;

  const downloadPage = (pageNumber: number) => {
    const out = outputs.find((o) => o.page === pageNumber);
    if (!out) return;
    downloadBlob(out.output.blob, out.name);
    track({ name: 'download', tool: TOOL_ID, kind: 'single' });
  };

  // "N images ready to download", once per run when every page is saved.
  const toasted = useRef(0);
  useEffect(() => {
    if (stats.total > 0 && stats.done === stats.total && toasted.current !== runId) {
      toasted.current = runId;
      toast(t.done(stats.done));
    }
  }, [stats.total, stats.done, runId]);

  const runCount = plan.ok ? plan.pages.length : 0;
  let actions;
  if (working) {
    actions = (
      <>
        <Button variant="primary" size="lg" block disabled>
          <LoaderCircle aria-hidden="true" className="animate-spin" />
          {t.saving}
        </Button>
        <Button size="lg" block onClick={() => runner.current?.cancel()}>
          {t.cancel}
        </Button>
      </>
    );
  } else if (exportFiles.length > 0) {
    actions = (
      <ExportBar
        // A new run starts with a fresh bar (no "ZIP ready" left from the last one).
        key={runId}
        variant="panel"
        folder="wide"
        files={exportFiles}
        zipName={zipName}
        onExport={(kind) => track({ name: 'download', tool: TOOL_ID, kind })}
      />
    );
  } else {
    actions = (
      <Button variant="primary" size="lg" block onClick={run} disabled={!canRun}>
        <Images aria-hidden="true" />
        {canRun ? t.run(runCount, formatName) : t.runShort}
      </Button>
    );
  }

  // Live size of the first chosen page.
  const firstPage = plan.ok ? (plan.pages[0] ?? 1) : 1;
  const firstSize = info.status === 'ready' ? info.info.pageSizes[firstPage - 1] : undefined;
  const preview = firstSize ? pageImageSize(firstSize, dpi) : undefined;
  const example = {
    pdfName: current?.name ?? 'document.pdf',
    page: firstPage,
    pageCount: Math.max(1, pageCount),
    width: preview?.width ?? 0,
    height: preview?.height ?? 0,
    format: settings.format,
  };

  return (
    <ToolPage
      meta={page}
      hasFiles={current !== undefined}
      empty={
        <ToolEmptyState
          dropZone={
            <DropZone
              accept={PDF_ONLY}
              title={t.dropTitle}
              subtitle={t.dropSubtitle}
              onFiles={setFile}
            />
          }
          sampleLabel={t.trySample}
          sampleBusy={sampleBusy}
          onSample={() => void trySample()}
        />
      }
      workspace={
        current && (
          <Workspace
            main={
              <div className="flex flex-col gap-4">
                {tasks.length > 0 && (
                  <Results
                    tasks={tasks}
                    names={nameOf}
                    working={working}
                    onDownload={downloadPage}
                    onRetry={(p) => runner.current?.retry(p)}
                    onRetryAll={() => runner.current?.retryAll()}
                  />
                )}
                <FileCard
                  file={current}
                  pages={pageCount}
                  status={info.status}
                  locked={locked}
                  picked={pageMode === 'choose' && plan.ok ? plan.pages : []}
                  busy={working}
                  onPage={clickPage}
                  onReplace={(raw) => void setRaw(raw)}
                  onRemove={removeFile}
                />
              </div>
            }
            panelTitle={t.panelTitle}
            onReset={() => {
              reset();
              resetPages();
              discard();
            }}
            panel={
              <SettingsPanel
                settings={settings}
                onChange={change}
                pageMode={pageMode}
                onPageMode={setMode}
                ranges={ranges}
                onRanges={setRanges}
                rangesTouched={rangesTouched}
                plan={plan}
                ready={ready}
                busy={working}
                firstPage={firstPage}
                preview={preview}
                example={example}
                stats={stats}
              />
            }
            actions={actions}
          />
        )
      }
    />
  );
}

function SettingsPanel({
  settings,
  onChange,
  pageMode,
  onPageMode,
  ranges,
  onRanges,
  rangesTouched,
  plan,
  ready,
  busy,
  firstPage,
  preview,
  example,
  stats,
}: {
  settings: PdfToImagesSettings;
  onChange: (patch: Partial<PdfToImagesSettings>) => void;
  pageMode: PageMode;
  onPageMode: (mode: PageMode) => void;
  ranges: string;
  onRanges: (text: string) => void;
  rangesTouched: boolean;
  plan: PagePlan;
  ready: boolean;
  busy: boolean;
  firstPage: number;
  preview: ReturnType<typeof pageImageSize> | undefined;
  example: Parameters<typeof pageFileName>[1];
  stats: ReturnType<typeof runStats>;
}) {
  const id = useId();
  const rangesId = `${id}-ranges`;
  const rangesHelpId = `${id}-ranges-help`;
  const rangesErrorId = `${id}-ranges-error`;
  const dpiId = `${id}-dpi`;
  const sizeId = `${id}-size`;
  const rangesError = pageMode === 'choose' && ready && !plan.ok ? plan.error : null;
  // An empty, untouched field shows the hint quietly instead of as an error.
  const showError = rangesError !== null && (rangesTouched || ranges.trim() !== '');
  const stopped = !stats.running && stats.total > 0 && stats.done + stats.failed < stats.total;

  return (
    <>
      <PanelSection>
        <Field>
          <span className="text-ui font-medium text-muted">{t.pagesHeading}</span>
          <Segmented<PageMode>
            label={t.pagesHeading}
            value={pageMode}
            disabled={busy}
            onValueChange={onPageMode}
            options={(['all', 'choose'] as const).map((mode) => ({
              value: mode,
              label: t.pageModes[mode],
            }))}
          />
        </Field>
        {pageMode === 'choose' && (
          <Field>
            <Label htmlFor={rangesId}>{t.rangesLabel}</Label>
            <Input
              id={rangesId}
              value={ranges}
              placeholder={t.rangesPlaceholder}
              spellCheck={false}
              autoComplete="off"
              inputMode="text"
              disabled={busy}
              aria-invalid={showError || undefined}
              aria-describedby={showError ? `${rangesErrorId} ${rangesHelpId}` : rangesHelpId}
              onChange={(e) => onRanges(e.target.value)}
              className={cn(showError && 'border-bad')}
            />
            <p
              id={rangesErrorId}
              aria-live="polite"
              className={cn('m-0 text-xs', showError ? 'text-bad' : 'hidden')}
            >
              {showError ? rangesError : ''}
            </p>
            <Helper id={rangesHelpId}>
              {rangesError !== null && !showError
                ? rangesError
                : plan.ok && ready
                  ? `${t.picked(plan.pages.length)}. ${t.rangesHelp}`
                  : t.rangesHelp}
            </Helper>
          </Field>
        )}
      </PanelSection>

      <PanelSection>
        <Field>
          <span className="text-ui font-medium text-muted">{t.format}</span>
          <Segmented
            label={t.format}
            value={settings.format}
            disabled={busy}
            onValueChange={(format) => onChange({ format })}
            options={PAGE_FORMATS.map((format) => ({ value: format, label: t.formats[format] }))}
          />
          <Helper>{t.formatHelp[settings.format]}</Helper>
        </Field>
      </PanelSection>

      <PanelSection>
        <Field>
          <span className="text-ui font-medium text-muted">{t.resolution}</span>
          <Segmented
            label={t.resolution}
            value={settings.resolution}
            disabled={busy}
            onValueChange={(resolution) => onChange({ resolution })}
            options={RESOLUTIONS.map((r) => ({ value: r, label: t.resolutions[r] }))}
          />
          <Helper>{t.resolutionHelp[settings.resolution]}</Helper>
        </Field>
        {settings.resolution === 'custom' && (
          <Field>
            <Label htmlFor={dpiId}>{t.customDpi}</Label>
            <NumberField
              id={dpiId}
              value={settings.customDpi}
              min={PAGE_IMAGE_LIMITS.minDpi}
              max={PAGE_IMAGE_LIMITS.maxDpi}
              unit={t.dpiUnit}
              disabled={busy}
              aria-describedby={sizeId}
              onValueChange={(customDpi) => onChange({ customDpi })}
            />
          </Field>
        )}
        {preview && (
          <p
            id={sizeId}
            data-testid="page-size"
            className="m-0 font-mono text-xs text-muted tabular-nums"
          >
            {t.pageSize(firstPage, preview.width, preview.height)}
            {preview.reduced ? t.pageSizeCapped(preview.dpi) : ''}
          </p>
        )}
      </PanelSection>

      {settings.format === 'jpeg' && (
        <PanelSection>
          <Field>
            <span className="text-ui font-medium text-muted">{t.quality}</span>
            <Segmented
              label={t.quality}
              value={settings.qualityMode}
              disabled={busy}
              onValueChange={(qualityMode) => onChange({ qualityMode })}
              options={QUALITY_MODES.map((mode) => ({ value: mode, label: t.qualityModes[mode] }))}
            />
            {settings.qualityMode === 'auto' && <Helper>{t.qualityAutoHelp}</Helper>}
          </Field>
          {settings.qualityMode === 'custom' && (
            <Slider
              label={t.qualityLevel}
              helper={t.qualityHelp}
              value={settings.quality}
              min={QUALITY_LIMITS.min}
              max={QUALITY_LIMITS.max}
              disabled={busy}
              onValueChange={(quality) => onChange({ quality })}
            />
          )}
        </PanelSection>
      )}

      <NamePatternField
        value={settings.rename}
        onChange={(rename) => onChange({ rename })}
        example={example}
        disabled={busy}
      />

      <div role="status" aria-live="polite" className="empty:hidden">
        {stats.running ? (
          <PanelSection>
            <span className="text-ui font-medium text-muted" data-testid="run-progress">
              {t.progress(stats.done, stats.total)}
            </span>
            <ProgressBar value={stats.progress} label={t.progressLabel} size="lg" />
          </PanelSection>
        ) : stopped ? (
          <Helper>{t.cancelled}</Helper>
        ) : null}
      </div>
    </>
  );
}

/** File names: like the image tools' pattern field, with {n} the zero-padded page number. */
function NamePatternField({
  value,
  onChange,
  example,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  example: Parameters<typeof pageFileName>[1];
  disabled: boolean;
}) {
  const id = useId();
  const helperId = `${id}-helper`;
  return (
    <Field>
      <span>
        <Label htmlFor={id}>{t.fileNames}</Label>
        <HelpTip label={t.fileNamesTipLabel}>{t.fileNamesTip}</HelpTip>
      </span>
      <Input
        id={id}
        className="font-mono"
        spellCheck={false}
        autoComplete="off"
        maxLength={MAX_PATTERN_LENGTH}
        aria-describedby={helperId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <Helper id={helperId} className="wrap-anywhere">
        {t.fileNamesExample}{' '}
        <span className="font-mono" data-testid="name-example">
          {pageFileName(value, example)}
        </span>{' '}
        · {t.fileNamesTokens}
      </Helper>
    </Field>
  );
}

function FileCard({
  file,
  pages,
  status,
  locked,
  picked,
  busy,
  onPage,
  onReplace,
  onRemove,
}: {
  file: IntakeFile;
  pages: number;
  status: 'loading' | 'ready' | 'error';
  locked: boolean;
  /** Pages picked in Choose pages (none in All pages). */
  picked: readonly number[];
  busy: boolean;
  onPage: (page: number) => void;
  onReplace: (files: File[]) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const drop = useFileDrop(onReplace, !busy);
  usePasteTarget(onReplace, !busy);
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    if (chosen.length > 0) onReplace(chosen);
  };

  const ready = status === 'ready' && !locked && pages > 0;

  return (
    <Card
      {...drop.props}
      className={cn(
        drop.over && 'border-accent bg-[color-mix(in_srgb,var(--accent-soft)_30%,var(--card))]',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <span className="min-w-0">
          <strong className="block truncate" title={file.name}>
            {file.name}
          </strong>
          <span className="text-ui text-muted">
            {ready ? `${t.pages(pages)} · ` : ''}
            {formatBytes(file.size)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <FileUp aria-hidden="true" />
            {t.changeFile}
          </Button>
          <IconButton label={t.removeFile(file.name)} disabled={busy} onClick={onRemove}>
            <Trash2 aria-hidden="true" className="size-4" />
          </IconButton>
          <input
            ref={inputRef}
            type="file"
            accept={acceptAttribute(PDF_ONLY)}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onPick}
          />
        </span>
      </div>
      {status === 'loading' ? (
        <p className="m-0 p-6 text-center text-muted">{t.reading}</p>
      ) : !ready ? (
        <p className="m-0 flex items-center justify-center gap-2 p-6 text-center text-bad">
          {locked ? (
            <Lock aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          )}
          {locked ? t.encrypted : t.unreadable}
        </p>
      ) : (
        <>
          <p className="m-0 px-3.5 pt-3 text-ui text-faint">{t.clickHint}</p>
          <ul
            aria-label={t.pagesLabel}
            className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2.5 p-3.5 sm:grid-cols-[repeat(auto-fill,minmax(104px,1fr))]"
          >
            {Array.from({ length: pages }, (_, i) => (
              <PageTile
                key={i}
                file={file.file}
                index={i}
                picked={pickedSet.has(i + 1)}
                disabled={busy}
                onClick={() => onPage(i + 1)}
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function PageTile({
  file,
  index,
  picked,
  disabled,
  onClick,
}: {
  file: Blob;
  index: number;
  picked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const pageNumber = index + 1;
  return (
    <li data-testid="pdf-page" data-picked={picked || undefined}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-pressed={picked}
        aria-label={t.pageLabel(pageNumber)}
        className={cn(
          'flex w-full cursor-pointer flex-col items-center gap-1 rounded-[10px] border border-line bg-card p-1.5 text-xs text-muted',
          'hover:border-faint disabled:cursor-not-allowed',
          picked && 'border-accent bg-accent-soft text-accent hover:border-accent',
        )}
      >
        <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-md bg-sunk">
          <PdfPageThumb file={file} pageIndex={index} maxSize={THUMB_SIZE} />
          {picked && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-accent text-on-accent"
            >
              <Check className="size-3" />
            </span>
          )}
        </span>
        <span aria-hidden="true">{pageNumber}</span>
      </button>
    </li>
  );
}

function Results({
  tasks,
  names,
  working,
  onDownload,
  onRetry,
  onRetryAll,
}: {
  tasks: readonly Task[];
  names: ReadonlyMap<number, string>;
  working: boolean;
  onDownload: (page: number) => void;
  onRetry: (page: number) => void;
  onRetryAll: () => void;
}) {
  const stats = runStats(tasks);
  const total = tasks.reduce((sum, task) => sum + (task.result?.bytes ?? 0), 0);
  const retryable = !working && stats.failed + stats.stopped > 0;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <strong data-testid="results-title">
          {t.resultsTitle(stats.done, stats.total)}{' '}
          {stats.done > 0 && <span className="font-normal text-muted">· {formatBytes(total)}</span>}
        </strong>
        {retryable && (
          <Button size="sm" variant="ghost" onClick={onRetryAll}>
            <RotateCcw aria-hidden="true" />
            {t.retryAll}
          </Button>
        )}
      </div>
      <ul aria-label={t.resultsLabel} className="m-0 max-h-[420px] list-none overflow-y-auto p-0">
        {tasks.map((task) => (
          <ResultRow
            key={task.page}
            task={task}
            name={names.get(task.page)}
            placeholder={t.pageLabel(task.page)}
            onDownload={onDownload}
            onRetry={onRetry}
          />
        ))}
      </ul>
    </Card>
  );
}

function ResultRow({
  task,
  name,
  placeholder,
  onDownload,
  onRetry,
}: {
  task: Task;
  name: string | undefined;
  placeholder: string;
  onDownload: (page: number) => void;
  onRetry: (page: number) => void;
}) {
  const out = task.result;
  return (
    <li
      data-testid="page-result"
      data-status={task.status}
      data-page={task.page}
      className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
    >
      <span
        className={cn(
          'grid size-8 place-items-center rounded-lg',
          task.status === 'done' ? 'bg-ok-bg text-ok' : 'bg-sunk text-faint',
          task.status === 'failed' && 'text-bad',
        )}
      >
        {task.status === 'failed' ? (
          <CircleAlert aria-hidden="true" className="size-4" />
        ) : (
          <FileImage aria-hidden="true" className="size-4" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium" title={name ?? placeholder}>
          {name ?? placeholder}
        </span>
        {out ? (
          <span className="block font-mono text-xs text-muted tabular-nums">
            {out.width} × {out.height} · {formatBytes(out.bytes)}
          </span>
        ) : task.status === 'failed' ? (
          <span className="block text-xs text-bad" data-testid="page-error">
            {task.error}
          </span>
        ) : (
          <span className="block text-xs text-muted">
            {task.status === 'waiting'
              ? t.statusWaiting
              : task.status === 'rendering'
                ? t.statusRendering
                : task.status === 'encoding'
                  ? t.statusEncoding
                  : t.statusCancelled}
          </span>
        )}
        {out?.reduced && (
          <span className="block text-xs text-warn" data-testid="reduced-note">
            {t.reducedDpi(out.dpi)}
          </span>
        )}
      </span>
      <span className="flex items-center justify-end gap-1.5">
        {(task.status === 'rendering' || task.status === 'encoding') && (
          <ProgressBar value={task.progress} label={t.pageProgressLabel(task.page)} />
        )}
        {out && name && (
          <IconButton label={t.download(name)} onClick={() => onDownload(task.page)}>
            <Download aria-hidden="true" className="size-4" />
          </IconButton>
        )}
        {(task.status === 'failed' || task.status === 'cancelled') && (
          <Button size="sm" variant="ghost" onClick={() => onRetry(task.page)}>
            <RotateCcw aria-hidden="true" />
            <span className="sr-only">{t.retryLabel(task.page)}</span>
            <span aria-hidden="true">{t.retry}</span>
          </Button>
        )}
      </span>
    </li>
  );
}
