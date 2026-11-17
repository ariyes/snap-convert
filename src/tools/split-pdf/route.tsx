// Split PDF (P19, PDF-03): every page, every N pages, or custom ranges ("1-3, 5, 8-10").
import {
  Check,
  CircleAlert,
  Download,
  FileText,
  FileUp,
  LoaderCircle,
  Lock,
  Scissors,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { usePendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import type { IntakeFile } from '@/core/contracts/intake';
import type { SplitInput } from '@/core/contracts/pdf';
import { downloadBlob, ExportBar, uniqueNames } from '@/features/export';
import {
  acceptAttribute,
  DropZone,
  keepAccepted,
  toIntakeFiles,
  useFileList,
  usePasteTarget,
} from '@/features/intake';
import { numberIn, oneOf, useToolSettings } from '@/features/settings';
import { Field, PanelSection, ToolEmptyState, ToolPage, Workspace } from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
  Button,
  Card,
  Helper,
  IconButton,
  Input,
  Label,
  NumberField,
  ProgressBar,
  Segmented,
  toast,
} from '@/ui';
import { formatBytes } from '@/tools/_shared';
import {
  INFO_LOADING,
  PdfPageThumb,
  samplePdfFile,
  SPLIT_SAMPLE,
  useFileDrop,
  usePdfInfos,
  usePdfJob,
} from '@/tools/_shared/pdf';
import { planSplit, SPLIT_MODES, togglePage, type SplitMode, type SplitPlan } from './plan';
import { splitStrings as t } from './strings';

const TOOL_ID = 'split-pdf';
const PDF_ONLY = ['pdf'] as const;
/** Page thumbnail long side, CSS px. */
const THUMB_SIZE = 140;

interface SplitSettings {
  mode: SplitMode;
  n: number;
}
const DEFAULTS: SplitSettings = { mode: 'every-page', n: 2 };
const SCHEMA = { mode: oneOf(SPLIT_MODES), n: numberIn(1, 100_000) };

export default function SplitPdfRoute() {
  const page = useToolPage();
  const { files, add, clear } = useFileList(TOOL_ID);
  const current = files[0];
  const currentList = useMemo(() => (current ? [current] : []), [current]);
  const infos = usePdfInfos(currentList);
  const info = (current && infos.get(current.file)) ?? INFO_LOADING;
  const [settings, update, reset] = useToolSettings(TOOL_ID, DEFAULTS, SCHEMA);
  const [ranges, setRangesText] = useState('');
  const [rangesTouched, setRangesTouched] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const { job, result, run, cancel, discard } = usePdfJob();

  const working = job?.status === 'waiting' || job?.status === 'working';
  const pageCount = info.status === 'ready' ? info.info.pages : 0;
  const encrypted = info.status === 'ready' && info.info.encrypted;
  const plan = useMemo(
    () => planSplit(settings.mode, settings.n, ranges, pageCount),
    [settings.mode, settings.n, ranges, pageCount],
  );
  const ready = info.status === 'ready' && !encrypted && pageCount > 0;
  const canSplit = ready && plan.ok && !working;

  // Any change makes an earlier result out of date.
  const changed = () => discard();
  const change = (patch: Partial<SplitSettings>) => {
    update(patch);
    changed();
  };
  const setRanges = (text: string) => {
    setRangesText(text);
    setRangesTouched(true);
    changed();
  };

  const setFile = (incoming: IntakeFile[]) => {
    const [pdf] = keepAccepted(incoming, PDF_ONLY);
    if (!pdf) return;
    clear();
    add([pdf]);
    setRangesText('');
    setRangesTouched(false);
    changed();
  };
  const setRaw = async (raw: File[]) => setFile(await toIntakeFiles(raw.slice(0, 1)));
  usePendingFiles(page.id, (raw) => void setRaw(raw));

  const removeFile = () => {
    clear();
    setRangesText('');
    setRangesTouched(false);
    changed();
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
    if (settings.mode !== 'ranges') change({ mode: 'ranges' });
    setRanges(togglePage(ranges, pageNumber, pageCount));
  };

  const split = () => {
    if (!canSplit || !current) return;
    const input: SplitInput = {
      file: { blob: current.file, name: current.name },
      mode: settings.mode,
      ...(settings.mode === 'every-n' ? { n: settings.n } : {}),
      ...(settings.mode === 'ranges' ? { ranges } : {}),
    };
    run('split', current.name, input);
    track({ name: 'tool-run', tool: TOOL_ID, files: 1 });
  };

  const parts = useMemo(() => {
    if (!result) return [];
    const names = uniqueNames(result.files.map((f) => f.name));
    return result.files.map((f, i) => ({ ...f, name: names[i] ?? f.name }));
  }, [result]);

  const downloadPart = (index: number) => {
    const part = parts[index];
    if (!part) return;
    downloadBlob(part.blob, part.name);
    track({ name: 'download', tool: TOOL_ID, kind: 'single' });
  };

  const exportFiles = useMemo(() => parts.map(({ blob, name }) => ({ blob, name })), [parts]);
  const zipName = `${(current?.name ?? 'document').replace(/\.pdf$/i, '')}${t.zipSuffix}`;

  // "Split. Ready to download", once per run.
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (job?.status === 'done' && toasted.current !== job.id) {
      toasted.current = job.id;
      toast(t.done);
    }
  }, [job]);

  const partCount = plan.ok ? plan.groups.length : 0;
  let actions;
  if (parts.length > 0) {
    actions = (
      <ExportBar
        // A new result starts with a fresh bar (no "ZIP ready" left from the last one).
        key={job?.id}
        variant="panel"
        folder="wide"
        files={exportFiles}
        zipName={zipName}
        singleLabel={t.downloadPdf}
        onExport={(kind) => track({ name: 'download', tool: TOOL_ID, kind })}
      />
    );
  } else if (working) {
    actions = (
      <>
        <Button variant="primary" size="lg" block disabled>
          <LoaderCircle aria-hidden="true" className="animate-spin" />
          {t.splitting}
        </Button>
        <Button size="lg" block onClick={cancel}>
          {t.cancel}
        </Button>
      </>
    );
  } else {
    actions = (
      <Button variant="primary" size="lg" block onClick={split} disabled={!canSplit}>
        <Scissors aria-hidden="true" />
        {plan.ok && ready ? t.split(partCount) : t.splitShort}
      </Button>
    );
  }

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
                {parts.length > 0 && <Results parts={parts} onDownload={downloadPart} />}
                <FileCard
                  file={current}
                  pages={pageCount}
                  status={info.status}
                  encrypted={encrypted}
                  plan={plan}
                  mode={settings.mode}
                  locked={working}
                  onPage={clickPage}
                  onReplace={(raw) => void setRaw(raw)}
                  onRemove={removeFile}
                />
              </div>
            }
            panelTitle={t.panelTitle}
            onReset={() => {
              reset();
              changed();
            }}
            panel={
              <SplitSettingsPanel
                settings={settings}
                onChange={change}
                ranges={ranges}
                onRanges={setRanges}
                rangesTouched={rangesTouched}
                plan={plan}
                ready={ready}
                pageCount={pageCount}
                locked={working}
                status={job?.status}
                progress={job?.progress ?? 0}
                error={job?.error}
              />
            }
            actions={actions}
          />
        )
      }
    />
  );
}

function SplitSettingsPanel({
  settings,
  onChange,
  ranges,
  onRanges,
  rangesTouched,
  plan,
  ready,
  pageCount,
  locked,
  status,
  progress,
  error,
}: {
  settings: SplitSettings;
  onChange: (patch: Partial<SplitSettings>) => void;
  ranges: string;
  onRanges: (text: string) => void;
  rangesTouched: boolean;
  plan: SplitPlan;
  ready: boolean;
  pageCount: number;
  locked: boolean;
  status: string | undefined;
  progress: number;
  error: string | undefined;
}) {
  const nId = useId();
  const rangesId = useId();
  const rangesHelpId = useId();
  const rangesErrorId = useId();
  const rangesError = settings.mode === 'ranges' && ready && !plan.ok ? plan.error : null;
  // An empty, untouched field shows the hint quietly instead of as an error.
  const showError = rangesError !== null && (rangesTouched || ranges.trim() !== '');

  return (
    <>
      <PanelSection>
        <Segmented
          label={t.modeLabel}
          value={settings.mode}
          disabled={locked}
          onValueChange={(mode) => onChange({ mode })}
          options={SPLIT_MODES.map((mode) => ({ value: mode, label: t.modes[mode] }))}
        />
        {settings.mode === 'every-n' && (
          <Field>
            <Label htmlFor={nId}>{t.everyN}</Label>
            <NumberField
              id={nId}
              value={settings.n}
              min={1}
              max={pageCount > 0 ? pageCount : undefined}
              disabled={locked}
              onValueChange={(n) => onChange({ n })}
            />
          </Field>
        )}
        {settings.mode === 'ranges' && (
          <Field>
            <Label htmlFor={rangesId}>{t.rangesLabel}</Label>
            <Input
              id={rangesId}
              value={ranges}
              placeholder={t.rangesPlaceholder}
              spellCheck={false}
              autoComplete="off"
              inputMode="text"
              disabled={locked}
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
              {rangesError !== null && !showError ? rangesError : t.rangesHelp}
            </Helper>
          </Field>
        )}
        {plan.ok && ready && <Helper>{t.partsPreview(plan.groups.length)}</Helper>}
      </PanelSection>
      <Helper>{t.keptNote}</Helper>
      <div role="status" aria-live="polite" className="empty:hidden">
        {status === 'waiting' || status === 'working' ? (
          <PanelSection>
            <span className="text-ui font-medium text-muted">{t.splitting}</span>
            <ProgressBar value={progress} label={t.progressLabel} size="lg" />
          </PanelSection>
        ) : status === 'cancelled' ? (
          <Helper>{t.cancelled}</Helper>
        ) : null}
      </div>
      {status === 'failed' && error && (
        <p role="alert" className="m-0 flex items-start gap-2 text-sm text-bad">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </>
  );
}

function FileCard({
  file,
  pages,
  status,
  encrypted,
  plan,
  mode,
  locked,
  onPage,
  onReplace,
  onRemove,
}: {
  file: IntakeFile;
  pages: number;
  status: 'loading' | 'ready' | 'error';
  encrypted: boolean;
  plan: SplitPlan;
  mode: SplitMode;
  locked: boolean;
  onPage: (page: number) => void;
  onReplace: (files: File[]) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const drop = useFileDrop(onReplace, !locked);
  usePasteTarget(onReplace, !locked);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    if (picked.length > 0) onReplace(picked);
  };

  // First part each page is in (1-based), and the pages picked in Custom ranges.
  const { partOf, picked } = useMemo(() => {
    const partOf = new Map<number, number>();
    const picked = new Set<number>();
    if (plan.ok) {
      plan.groups.forEach((group, i) => {
        for (const p of group) {
          if (!partOf.has(p)) partOf.set(p, i + 1);
          if (mode === 'ranges') picked.add(p);
        }
      });
    }
    return { partOf, picked };
  }, [plan, mode]);

  const ready = status === 'ready' && !encrypted && pages > 0;

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
            disabled={locked}
            onClick={() => inputRef.current?.click()}
          >
            <FileUp aria-hidden="true" />
            {t.changeFile}
          </Button>
          <IconButton label={t.removeFile(file.name)} disabled={locked} onClick={onRemove}>
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
          {encrypted ? (
            <Lock aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          )}
          {encrypted ? t.encrypted : t.unreadable}
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
                // With one part per page the part number is the page number: shown once.
                part={mode === 'every-page' ? undefined : partOf.get(i + 1)}
                picked={picked.has(i + 1)}
                pressable={mode === 'ranges'}
                disabled={locked}
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
  part,
  picked,
  pressable,
  disabled,
  onClick,
}: {
  file: Blob;
  index: number;
  part: number | undefined;
  picked: boolean;
  pressable: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const pageNumber = index + 1;
  return (
    <li data-testid="split-page" data-picked={picked || undefined}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-pressed={pressable ? picked : undefined}
        aria-label={part ? t.pageInParts(pageNumber, part) : t.pageLabel(pageNumber)}
        className={cn(
          'flex w-full cursor-pointer flex-col items-center gap-1 rounded-[10px] border border-line bg-card p-1.5 text-xs text-muted',
          'hover:border-faint disabled:cursor-not-allowed',
          picked && 'border-accent bg-accent-soft text-accent hover:border-accent',
        )}
      >
        <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-md bg-sunk">
          <PdfPageThumb file={file} pageIndex={index} maxSize={THUMB_SIZE} />
          {part !== undefined && (
            <span
              aria-hidden="true"
              className="absolute top-1 left-1 grid h-5 min-w-5 place-items-center rounded-full bg-sunk px-1.5 text-2xs font-semibold text-muted"
            >
              {part}
            </span>
          )}
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
  parts,
  onDownload,
}: {
  parts: Array<{ blob: Blob; name: string; pages: number }>;
  onDownload: (index: number) => void;
}) {
  const total = parts.reduce((sum, p) => sum + p.blob.size, 0);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <strong>
          {t.resultsTitle(parts.length)}{' '}
          <span className="font-normal text-muted">· {formatBytes(total)}</span>
        </strong>
      </div>
      <ul aria-label={t.resultsLabel} className="m-0 max-h-[420px] list-none overflow-y-auto p-0">
        {parts.map((part, i) => (
          <li
            key={`${i}-${part.name}`}
            data-testid="split-part"
            className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-ok-bg text-ok">
              <FileText aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium" title={part.name}>
                {part.name}
              </span>
              <span className="text-xs text-muted">
                {t.partPages(part.pages)} · {formatBytes(part.blob.size)}
              </span>
            </span>
            <IconButton label={t.downloadPart(part.name)} onClick={() => onDownload(i)}>
              <Download aria-hidden="true" className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
    </Card>
  );
}
