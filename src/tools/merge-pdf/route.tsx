// Merge PDF (P19, PDF-02): combine several PDFs into one, in any order.
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Combine,
  Download,
  FileCheck2,
  LoaderCircle,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { usePendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import type { IntakeFile } from '@/core/contracts/intake';
import type { MergeInput } from '@/core/contracts/pdf';
import { downloadBlob, safeFileName } from '@/features/export';
import {
  acceptAttribute,
  DropZone,
  toIntakeFiles,
  useFileList,
  usePasteTarget,
} from '@/features/intake';
import { Field, PanelSection, ToolEmptyState, ToolPage, Workspace } from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { Button, Card, Helper, IconButton, Input, Label, Note, ProgressBar, toast } from '@/ui';
import { formatBytes } from './format';
import { PdfPageThumb } from './pdf-thumb';
import { MERGE_SAMPLES, samplePdfFile } from './sample-pdfs';
import { mergeStrings as t, pagesText } from './strings';
import { useFileDrop } from './use-file-drop';
import { INFO_LOADING, usePdfInfos, type PdfInfoState } from './use-pdf-infos';
import { usePdfJob } from './use-pdf-job';
import { usePointerReorder, type ReorderDrag } from './use-pointer-reorder';

const TOOL_ID = 'merge-pdf';
const PDF_ONLY = ['pdf'] as const;
/** Thumbnail long side, CSS px (cards are about 140–200 px wide). */
const THUMB_SIZE = 220;

interface Entry {
  file: IntakeFile;
  info: PdfInfoState;
  /** Goes into the merge: a readable PDF without a password. */
  included: boolean;
  /** Position in the merged PDF (1-based) when included. */
  order: number | null;
}

/** "merged", "report.pdf " → a safe file name for the merged PDF ("merged.pdf", "report.pdf"). */
function outFileName(typed: string): string {
  const base = typed.trim().replace(/\.pdf$/i, '') || t.defaultName;
  return safeFileName(`${base}.pdf`, t.defaultName);
}

export default function MergePdfRoute() {
  const page = useToolPage();
  const { files, add, remove, reorder } = useFileList(TOOL_ID);
  const infos = usePdfInfos(files);
  const { job, result, run, cancel, discard } = usePdfJob();
  const [outName, setOutName] = useState<string>(t.defaultName);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const working = job?.status === 'waiting' || job?.status === 'working';

  const entries = useMemo<Entry[]>(() => {
    let order = 0;
    return files.map((file) => {
      const info = infos.get(file.file) ?? INFO_LOADING;
      const included = info.status === 'ready' && !info.info.encrypted;
      return { file, info, included, order: included ? ++order : null };
    });
  }, [files, infos]);
  const included = entries.filter((e) => e.included);
  const reading = entries.some((e) => e.info.status === 'loading');

  // Any change to the list makes an earlier result out of date.
  const addFiles = (incoming: IntakeFile[]) => {
    if (add(incoming, { accept: PDF_ONLY }).length > 0) discard();
  };
  const addRaw = async (raw: File[]) => addFiles(await toIntakeFiles(raw));
  usePendingFiles(page.id, (raw) => void addRaw(raw));

  const moveFile = (from: number, to: number) => {
    const entry = entries[from];
    if (!entry || to < 0 || to >= entries.length || from === to) return;
    reorder(from, to);
    discard();
    setAnnouncement(t.moved(entry.file.name, to + 1, entries.length));
  };
  const removeFile = (entry: Entry) => {
    remove(entry.file.id);
    discard();
    setAnnouncement(t.removed(entry.file.name));
  };

  const trySamples = async () => {
    setSampleBusy(true);
    try {
      addFiles(await toIntakeFiles(MERGE_SAMPLES.map(samplePdfFile)));
    } finally {
      setSampleBusy(false);
    }
  };

  const merge = () => {
    if (included.length < 2 || reading || working) return;
    const name = outFileName(outName);
    const input: MergeInput = {
      files: included.map((e) => ({ blob: e.file.file, name: e.file.name })),
      outName: name,
    };
    run('merge', name, input);
    track({ name: 'tool-run', tool: TOOL_ID, files: included.length });
  };

  const output = result?.files[0];
  const download = () => {
    if (!output) return;
    downloadBlob(output.blob, outFileName(outName));
    track({ name: 'download', tool: TOOL_ID, kind: 'single' });
  };

  // "Merged. Ready to download", once per run.
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (job?.status === 'done' && toasted.current !== job.id) {
      toasted.current = job.id;
      toast(t.merged);
    }
  }, [job]);

  const canMerge = included.length >= 2 && !reading && !working;
  const actions = output ? (
    <Button variant="primary" size="lg" block onClick={download}>
      <Download aria-hidden="true" />
      {t.download}
    </Button>
  ) : working ? (
    <>
      <Button variant="primary" size="lg" block disabled>
        <LoaderCircle aria-hidden="true" className="animate-spin" />
        {t.merging}
      </Button>
      <Button size="lg" block onClick={cancel}>
        {t.cancel}
      </Button>
    </>
  ) : (
    <Button variant="primary" size="lg" block onClick={merge} disabled={!canMerge}>
      <Combine aria-hidden="true" />
      {t.merge(included.length)}
    </Button>
  );

  return (
    <ToolPage
      meta={page}
      hasFiles={files.length > 0}
      empty={
        <ToolEmptyState
          dropZone={
            <DropZone
              accept={PDF_ONLY}
              multiple
              title={t.dropTitle}
              subtitle={t.dropSubtitle}
              onFiles={addFiles}
            />
          }
          sampleLabel={t.trySamples}
          sampleBusy={sampleBusy}
          onSample={() => void trySamples()}
        />
      }
      workspace={
        <Workspace
          main={
            <MergeGrid
              entries={entries}
              included={included}
              reading={reading}
              locked={working}
              onMove={moveFile}
              onRemove={removeFile}
              onAdd={(raw) => void addRaw(raw)}
              announcement={announcement}
            />
          }
          panelTitle={t.panelTitle}
          panel={
            <>
              <OutputName value={outName} onChange={setOutName} />
              <Note>
                {t.sizeNoteBefore} <Link to="/resize-pdf">{t.sizeNoteLink}</Link> {t.sizeNoteAfter}
              </Note>
              <Helper>{t.keptNote}</Helper>
              <MergeStatus
                count={included.length}
                reading={reading}
                status={job?.status}
                progress={job?.progress ?? 0}
                error={job?.error}
                outName={outFileName(outName)}
                output={output}
              />
            </>
          }
          actions={actions}
        />
      }
    />
  );
}

function OutputName({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <Field>
      <Label htmlFor={id}>{t.fileName}</Label>
      <div className="relative flex items-center">
        <Input
          id={id}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          className="pr-11"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 text-ui text-faint"
        >
          .pdf
        </span>
      </div>
    </Field>
  );
}

function MergeStatus({
  count,
  reading,
  status,
  progress,
  error,
  outName,
  output,
}: {
  count: number;
  reading: boolean;
  status: string | undefined;
  progress: number;
  error: string | undefined;
  outName: string;
  output: { blob: Blob; pages: number } | undefined;
}) {
  let body: ReactNode = null;
  if (output) {
    body = (
      <div className="flex items-center gap-3.5 rounded-xl bg-ok-bg p-4 text-ok">
        <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-card">
          <FileCheck2 aria-hidden="true" className="size-5" />
        </span>
        <span className="min-w-0 text-ui">
          <strong className="block truncate text-body text-fg">{outName}</strong>
          <span>
            {pagesText(output.pages)} · {formatBytes(output.blob.size)}
          </span>
        </span>
      </div>
    );
  } else if (status === 'waiting' || status === 'working') {
    body = (
      <PanelSection>
        <span className="text-ui font-medium text-muted">{t.merging}</span>
        <ProgressBar value={progress} label={t.progressLabel} size="lg" />
      </PanelSection>
    );
  } else if (status === 'failed' && error) {
    body = (
      <p role="alert" className="m-0 flex items-start gap-2 text-sm text-bad">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {error}
      </p>
    );
  } else if (count < 2) {
    body = reading ? <Helper>{t.reading}</Helper> : <Helper>{t.needTwo}</Helper>;
  } else if (status === 'cancelled') {
    body = <Helper>{t.cancelled}</Helper>;
  }
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {body}
    </div>
  );
}

function MergeGrid({
  entries,
  included,
  reading,
  locked,
  onMove,
  onRemove,
  onAdd,
  announcement,
}: {
  entries: Entry[];
  included: Entry[];
  reading: boolean;
  locked: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (entry: Entry) => void;
  onAdd: (files: File[]) => void;
  announcement: string;
}) {
  const { drag, containerRef, itemProps } = usePointerReorder({ onMove, disabled: locked });
  const drop = useFileDrop(onAdd, !locked);
  usePasteTarget(onAdd, !locked);

  // Keyboard moves keep focus on the button that was pressed (or its partner at either end).
  const pendingFocus = useRef<{ id: string; dir: 'earlier' | 'later' } | null>(null);
  const gridRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const want = pendingFocus.current;
    pendingFocus.current = null;
    if (!want || !gridRef.current) return;
    const find = (dir: string) =>
      gridRef.current?.querySelector<HTMLButtonElement>(
        `[data-move="${dir}"][data-file-id="${CSS.escape(want.id)}"]`,
      );
    const button = find(want.dir);
    const other = find(want.dir === 'earlier' ? 'later' : 'earlier');
    (button && !button.disabled ? button : other)?.focus();
  }, [entries]);

  const pages = included.reduce(
    (sum, e) => sum + (e.info.status === 'ready' ? e.info.info.pages : 0),
    0,
  );
  const size = entries
    .filter((e) => e.included || e.info.status === 'loading')
    .reduce((sum, e) => sum + e.file.size, 0);
  const counted = entries.filter((e) => e.included || e.info.status === 'loading').length;

  return (
    <Card
      {...drop.props}
      className={cn(
        drop.over && 'border-accent bg-[color-mix(in_srgb,var(--accent-soft)_30%,var(--card))]',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <strong>
          {t.pdfCount(counted)}{' '}
          <span className="font-normal text-muted">
            {t.totals(pages, reading, formatBytes(size))}
          </span>
        </strong>
        <span className="text-ui text-faint">{t.dragHint}</span>
      </div>
      <ol
        ref={(el) => {
          gridRef.current = el;
          containerRef(el);
        }}
        aria-label={t.listLabel}
        className="m-0 grid list-none grid-cols-2 gap-3 p-3.5 min-[560px]:grid-cols-3 min-[1000px]:grid-cols-4"
      >
        {entries.map((entry, index) => (
          <MergeCard
            key={entry.file.id}
            entry={entry}
            index={index}
            last={index === entries.length - 1}
            drag={drag}
            locked={locked}
            itemProps={itemProps(index)}
            onMove={(to, dir) => {
              pendingFocus.current = { id: entry.file.id, dir };
              onMove(index, to);
            }}
            onRemove={() => onRemove(entry)}
          />
        ))}
        <li>
          <AddTile onFiles={onAdd} disabled={locked} />
        </li>
      </ol>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </Card>
  );
}

function MergeCard({
  entry,
  index,
  last,
  drag,
  locked,
  itemProps,
  onMove,
  onRemove,
}: {
  entry: Entry;
  index: number;
  last: boolean;
  drag: ReorderDrag | null;
  locked: boolean;
  itemProps: ReturnType<ReturnType<typeof usePointerReorder>['itemProps']>;
  onMove: (to: number, dir: 'earlier' | 'later') => void;
  onRemove: () => void;
}) {
  const { file, info } = entry;
  const dragging = drag?.from === index;
  const target = drag !== null && drag.over === index && drag.from !== index;
  const pages = info.status === 'ready' ? info.info.pages : null;
  const encrypted = info.status === 'ready' && info.info.encrypted;
  const unreadable = info.status === 'error';
  const excluded = encrypted || unreadable;

  return (
    <li
      {...itemProps}
      data-testid="merge-card"
      data-dragging={dragging || undefined}
      data-drop-target={target || undefined}
      style={dragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
      className={cn(
        'relative flex min-w-0 cursor-grab flex-col gap-2 rounded-[10px] border border-line bg-card p-2.5 select-none',
        'transition-[border-color,opacity,transform,box-shadow] duration-150 hover:border-faint',
        '[-webkit-touch-callout:none]',
        dragging &&
          'pointer-events-none z-10 cursor-grabbing opacity-80 shadow-card transition-none',
        target && 'scale-[1.02] border-accent hover:border-accent',
        locked && 'cursor-default',
      )}
    >
      {entry.order !== null && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 left-1.5 z-[1] grid h-[22px] min-w-[22px] place-items-center rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent"
        >
          {entry.order}
        </span>
      )}
      <div
        className={cn(
          'relative aspect-[1/1.3] overflow-hidden rounded-md border border-line bg-sunk',
          excluded && 'grid place-items-center',
        )}
      >
        {encrypted ? (
          <Lock aria-hidden="true" className="size-7 text-faint" />
        ) : unreadable ? (
          <CircleAlert aria-hidden="true" className="size-7 text-faint" />
        ) : (
          <PdfPageThumb file={file.file} pageIndex={0} maxSize={THUMB_SIZE} />
        )}
        {!excluded && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-sunk px-[5px] py-px font-mono text-[10px] text-muted">
            {pages === null ? t.pagesUnknownShort : t.pagesShort(pages)}
          </span>
        )}
      </div>
      <div className="truncate text-ui font-medium" title={file.name}>
        {file.name}
      </div>
      {excluded ? (
        <p className="m-0 text-xs text-bad">{encrypted ? t.encrypted : t.unreadable}</p>
      ) : (
        <div className="flex justify-between gap-1.5 text-xs text-muted">
          <span>{pages === null ? t.pagesUnknown : pagesText(pages)}</span>
          <span>{formatBytes(file.size)}</span>
        </div>
      )}
      <div className="flex justify-between gap-1">
        <span className="flex gap-0.5">
          <IconButton
            size="sm"
            label={t.moveEarlier(file.name)}
            data-move="earlier"
            data-file-id={file.id}
            disabled={locked || index === 0}
            onClick={() => onMove(index - 1, 'earlier')}
          >
            <ArrowLeft aria-hidden="true" />
          </IconButton>
          <IconButton
            size="sm"
            label={t.moveLater(file.name)}
            data-move="later"
            data-file-id={file.id}
            disabled={locked || last}
            onClick={() => onMove(index + 1, 'later')}
          >
            <ArrowRight aria-hidden="true" />
          </IconButton>
        </span>
        <IconButton size="sm" label={t.remove(file.name)} disabled={locked} onClick={onRemove}>
          <Trash2 aria-hidden="true" />
        </IconButton>
      </div>
    </li>
  );
}

/** Prototype `.add-tile`: pick more PDFs (or drop them anywhere on the list). */
function AddTile({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    if (picked.length > 0) onFiles(picked);
  };
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex size-full min-h-[180px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px]',
          'border-[1.5px] border-dashed border-line bg-transparent text-ui text-muted',
          'hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        <Plus aria-hidden="true" className="size-5" />
        {t.addPdfs}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptAttribute(PDF_ONLY)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onChange}
      />
    </>
  );
}
