/**
 * The shared single-image screen (P15): Resize, Convert, HEIC to JPG and the format pages.
 * Files on the left (thumbnails, the result preview with its size and dimensions, notes), the
 * tool's settings on the right, Download / ZIP at the bottom. Every file is processed in the image
 * worker with the current settings and re-run when they change; results come from the shared queue.
 */
import {
  CircleAlert,
  ImageIcon,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { usePendingFiles } from '@/app/pending-files';
import type { ImageJobResult } from '@/core/contracts/image';
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import type { Size } from '@/core/contracts/sizing';
import type { ToolMeta } from '@/core/contracts/tools';
import { useQueue } from '@/core/queue';
import { ExportBar } from '@/features/export';
import {
  acceptAttribute,
  DropZone,
  keepAccepted,
  toIntakeFiles,
  useFileList,
  usePasteTarget,
} from '@/features/intake';
import { ToolEmptyState, ToolPage, Workspace } from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { Button, Card, Note, strings as uiStrings } from '@/ui';
import { useBlobUrls } from './blob-urls';
import { formatBytes, sizeChange } from './format';
import { outputFileNames } from './names';
import { resultNotes } from './notes';
import { singleImageStrings as strings } from './strings';
import { useImageJobs, type FileJob, type ImageJobOptions } from './use-image-jobs';

/** What the settings panel may need about the file on screen. */
export interface SingleImageContext {
  /** The file on screen. */
  file: IntakeFile | undefined;
  /** Its visible size from the file header (for <DimsPreview>), when known. */
  source: Size | undefined;
  /** Its latest result with the current settings, when finished. */
  result: ImageJobResult | undefined;
}

export interface SingleImageToolProps {
  /** Registry entry (tool or format page): heading, breadcrumb, file list, pending files, analytics. */
  page: Pick<ToolMeta, 'id' | 'name' | 'group' | 'short'>;
  /** Kinds the drop zone, picker and paste take. */
  accept: readonly FileKind[];
  dropTitle?: string;
  dropSubtitle?: string;
  /** Replaces the registry's short line under the title. */
  description?: ReactNode;
  /**
   * Sees every incoming file (after the kind check) and returns the ones to keep, e.g. HEIC to
   * JPG sends other images to Convert image.
   */
  onIncoming?: (files: IntakeFile[]) => IntakeFile[];
  /** Shown above the drop zone and above the files (e.g. "these went to Convert image"). */
  notice?: ReactNode;
  /** Job settings for every file (from the tool's settings). */
  jobOptions: ImageJobOptions;
  /** Output name pattern (IMG-09); without one: the original name with the new extension. */
  namePattern?: string;
  panelTitle: ReactNode;
  panelIntro?: ReactNode;
  panel: (context: SingleImageContext) => ReactNode;
  onReset: () => void;
}

const STATUS_BUSY = new Set(['waiting', 'working']);

export function SingleImageTool({
  page,
  accept,
  dropTitle,
  dropSubtitle,
  description,
  onIncoming,
  notice,
  jobOptions,
  namePattern,
  panelTitle,
  panelIntro,
  panel,
  onReset,
}: SingleImageToolProps) {
  const toolId = page.id;
  const files = useFileList(toolId, (s) => s.files);
  const addFiles = useFileList(toolId, (s) => s.add);
  const removeFile = useFileList(toolId, (s) => s.remove);
  const clearFiles = useFileList(toolId, (s) => s.clear);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = files.find((f) => f.id === selectedId) ?? files[0];

  const take = useCallback(
    (incoming: IntakeFile[]) => {
      const kept = onIncoming ? onIncoming(incoming) : incoming;
      const added = addFiles(kept, { accept });
      if (added[0]) setSelectedId(added[0].id);
    },
    [accept, addFiles, onIncoming],
  );
  const takeRaw = useCallback(
    (raw: File[]) => {
      void toIntakeFiles(raw).then((read) => take(keepAccepted(read, accept)));
    },
    [accept, take],
  );
  usePendingFiles(toolId, takeRaw);
  // The drop zone takes pastes while it's on screen; after that, the workspace does.
  usePasteTarget(takeRaw, files.length > 0);

  const { byFile, retry } = useImageJobs(files, jobOptions, {
    first: selected?.id,
    onQueued: (count) => track({ name: 'tool-run', tool: toolId, files: count }),
  });

  // Results to export: every file that hasn't failed, in list order. Exporting waits until all
  // of them are finished with the current settings.
  const exportable = files.flatMap((file, i) => {
    const fileJob = byFile.get(file.id);
    if (fileJob?.current && fileJob.job.status === 'failed') return [];
    return [{ file, n: i + 1, result: fileJob?.current ? fileJob.result : undefined }];
  });
  const pending = exportable.some((e) => !e.result);
  const names = outputFileNames(
    exportable.map((e) => ({
      fileName: e.file.name,
      n: e.n,
      width: e.result?.width ?? 0,
      height: e.result?.height ?? 0,
      format: e.result?.format ?? 'jpeg',
    })),
    namePattern,
  );
  const exportFiles = exportable.map((e, i) => ({
    blob: e.result?.blob ?? EMPTY_BLOB,
    name: names[i] ?? e.file.name,
  }));
  const selectedIndex = exportable.findIndex((e) => e.file.id === selected?.id);

  const shownBlobs = useMemo(() => {
    const set = new Set<Blob>();
    for (const fileJob of byFile.values()) if (fileJob.result) set.add(fileJob.result.blob);
    return set;
  }, [byFile]);
  const blobUrl = useBlobUrls(shownBlobs);

  const selectedJob = selected ? byFile.get(selected.id) : undefined;
  const context: SingleImageContext = {
    file: selected,
    source: sourceSize(selected),
    result: selectedJob?.current ? selectedJob.result : undefined,
  };

  const dropZone = (
    <DropZone
      accept={accept}
      multiple
      pasteHint
      onFiles={take}
      title={dropTitle}
      subtitle={dropSubtitle}
    />
  );

  const main = selected && (
    <div className="flex flex-col gap-3">
      {notice}
      <Card className="flex flex-col gap-3 p-3">
        {files.length > 1 && (
          <FileStrip
            files={files}
            byFile={byFile}
            selectedId={selected.id}
            onSelect={setSelectedId}
            blobUrl={blobUrl}
            accept={accept}
            onAdd={takeRaw}
          />
        )}
        <Preview
          file={selected}
          fileJob={selectedJob}
          blobUrl={blobUrl}
          onRetry={() => retry(selected.id)}
        />
        <Stats file={selected} fileJob={selectedJob} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="min-w-0 flex-[1_1_140px] truncate text-sm font-medium"
            data-testid="file-name"
          >
            {selected.name}
          </span>
          <span className="relative flex flex-none gap-1.5">
            {files.length === 1 && <AddButton accept={accept} onAdd={takeRaw} withText />}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const at = files.findIndex((f) => f.id === selected.id);
                const next = files[at + 1] ?? files[at - 1];
                setSelectedId(next?.id ?? null);
                removeFile(selected.id);
              }}
            >
              <Trash2 aria-hidden="true" />
              {uiStrings.remove}
            </Button>
            {files.length > 1 && (
              <Button size="sm" variant="ghost" onClick={clearFiles}>
                {strings.removeAll}
              </Button>
            )}
          </span>
        </div>
      </Card>
    </div>
  );

  return (
    <ToolPage
      meta={page}
      description={description}
      hasFiles={files.length > 0}
      empty={
        <ToolEmptyState
          dropZone={
            <div className="flex flex-col gap-3">
              {notice}
              {dropZone}
            </div>
          }
        />
      }
      workspace={
        <Workspace
          main={main}
          panelTitle={panelTitle}
          panelIntro={panelIntro}
          panel={panel(context)}
          onReset={onReset}
          actions={
            <ExportBar
              files={exportFiles}
              selected={selectedIndex >= 0 ? selectedIndex : undefined}
              zipName={strings.zipName(toolId)}
              disabled={pending}
              onExport={(kind) => track({ name: 'download', tool: toolId, kind })}
              className={EXPORT_BAR_CLASS}
            />
          }
        />
      }
    />
  );
}

/** Stands in for results still being made; exporting is disabled until they're all real. */
const EMPTY_BLOB = new Blob([]);

/**
 * The export bar inside the settings panel (full-width buttons, Download first and tall) and in
 * the phone action bar (one row; "Save to folder" stays on wide screens).
 */
const EXPORT_BAR_CLASS = cn(
  'max-[880px]:h-auto! max-[880px]:gap-1.5',
  '[&_button]:w-full [&>div:first-child]:flex-col',
  'min-[880px]:[&>div:first-child>button:first-child]:h-12 min-[880px]:[&>div:first-child>button:first-child]:text-base',
  'max-[880px]:[&>div:first-child]:flex-row-reverse max-[880px]:[&>div:first-child]:flex-nowrap',
  // Natural widths, sharing what's left: "Download all 30 as ZIP" needs more room than "Download".
  'max-[880px]:[&_button]:min-w-0 max-[880px]:[&_button]:flex-auto max-[880px]:[&_button]:px-3 max-[880px]:[&_button]:text-ui',
  'max-[880px]:[&_button[title]]:hidden',
);

function sourceSize(file: IntakeFile | undefined): Size | undefined {
  if (!file || file.width === undefined || file.height === undefined) return undefined;
  return { width: file.width, height: file.height };
}

/** "Add images": a picker for more files (checked by their bytes like everything else). */
function AddButton({
  accept,
  onAdd,
  withText = false,
}: {
  accept: readonly FileKind[];
  onAdd: (files: File[]) => void;
  withText?: boolean;
}) {
  const id = useId();
  return (
    <>
      <input
        id={id}
        type="file"
        multiple
        className="peer sr-only"
        accept={acceptAttribute(accept)}
        onChange={(e) => {
          const picked = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (picked.length > 0) onAdd(picked);
        }}
      />
      <label
        htmlFor={id}
        title={strings.addImages}
        className={cn(
          'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent font-medium whitespace-nowrap text-muted',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent hover:bg-sunk hover:text-fg',
          withText ? 'h-8 px-2.5 text-ui' : 'size-14 rounded-lg bg-sunk',
        )}
      >
        <Plus aria-hidden="true" className="size-4" />
        {withText ? strings.addImages : <span className="sr-only">{strings.addImages}</span>}
      </label>
    </>
  );
}

function FileStrip({
  files,
  byFile,
  selectedId,
  onSelect,
  blobUrl,
  accept,
  onAdd,
}: {
  files: readonly IntakeFile[];
  byFile: ReadonlyMap<string, FileJob>;
  selectedId: string;
  onSelect: (id: string) => void;
  blobUrl: (blob: Blob) => string;
  accept: readonly FileKind[];
  onAdd: (files: File[]) => void;
}) {
  const listId = useId();
  let done = 0;
  let failed = 0;
  for (const f of files) {
    const fileJob = byFile.get(f.id);
    if (!fileJob?.current) continue;
    if (fileJob.job.status === 'done') done += 1;
    if (fileJob.job.status === 'failed') failed += 1;
  }
  const eta = useQueueEta(done + failed < files.length);

  return (
    <div className="flex flex-col gap-2">
      <p
        id={listId}
        role="status"
        className="m-0 flex flex-wrap items-center gap-x-2 text-ui text-muted"
      >
        <span>{strings.progress(done, files.length)}</span>
        {eta !== null && <span>· {strings.timeLeft(eta)}</span>}
        {failed > 0 && <span className="text-bad">· {strings.failedCount(failed)}</span>}
      </p>
      <ul
        aria-label={strings.filesLabel}
        // `relative`: keeps the add button's hidden input inside the scroll area (no page overflow).
        className="relative m-0 flex list-none gap-2 overflow-x-auto p-0 pb-0.5"
      >
        {files.map((f) => {
          const fileJob = byFile.get(f.id);
          const status = fileJob?.current ? fileJob.job.status : 'waiting';
          const src = fileJob?.result ? blobUrl(fileJob.result.blob) : f.thumbUrl;
          return (
            <li key={f.id} className="shrink-0">
              <button
                type="button"
                aria-label={f.name}
                aria-current={f.id === selectedId}
                onClick={() => onSelect(f.id)}
                className={cn(
                  'relative grid size-14 cursor-pointer place-items-center overflow-hidden rounded-lg border-2 border-transparent bg-sunk p-0',
                  'aria-[current=true]:border-accent',
                )}
              >
                {src ? (
                  <img src={src} alt="" className="size-full object-cover" />
                ) : (
                  <ImageIcon aria-hidden="true" className="size-5 text-faint" />
                )}
                {STATUS_BUSY.has(status) && (
                  <span className="absolute inset-0 grid place-items-center bg-scrim/40">
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-4 animate-spin text-on-scrim"
                    />
                  </span>
                )}
                {status === 'failed' && (
                  <span className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-bad-bg">
                    <CircleAlert aria-hidden="true" className="size-3.5 text-bad" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
        <li className="relative shrink-0">
          <AddButton accept={accept} onAdd={onAdd} />
        </li>
      </ul>
    </div>
  );
}

/** Time left for the queue's current run (shared by all tools; only this one runs at a time). */
function useQueueEta(active: boolean): number | null {
  const eta = useQueue((s) => s.stats.etaSeconds);
  return active ? eta : null;
}

function Preview({
  file,
  fileJob,
  blobUrl,
  onRetry,
}: {
  file: IntakeFile;
  fileJob: FileJob | undefined;
  blobUrl: (blob: Blob) => string;
  onRetry: () => void;
}) {
  const result = fileJob?.result;
  const status = fileJob?.job.status;
  const current = fileJob?.current ?? false;
  const failed = current && status === 'failed';
  const busy = !failed && (!current || !result);
  const shape: Size = result ?? sourceSize(file) ?? { width: 4, height: 3 };
  const src = result ? blobUrl(result.blob) : file.thumbUrl;

  return (
    <div
      className="relative mx-auto max-h-[62vh] overflow-hidden rounded-control bg-checker"
      style={{
        aspectRatio: `${shape.width} / ${shape.height}`,
        // As big as fits, but never bigger than the image itself (a small image isn't blown up).
        width: `min(100%, calc(62vh * ${shape.width} / ${shape.height}), ${shape.width}px)`,
      }}
      data-testid="preview"
      aria-busy={busy || undefined}
    >
      {src && !failed && (
        <img
          src={src}
          alt={strings.previewAlt(file.name)}
          className={cn(
            'absolute inset-0 size-full object-contain transition-opacity',
            busy && 'opacity-60',
          )}
        />
      )}
      {!src && !failed && (
        <span className="absolute inset-0 grid place-items-center text-faint">
          <ImageIcon aria-hidden="true" className="size-8" />
          <span className="sr-only">{strings.noPreview}</span>
        </span>
      )}
      {busy && (
        <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-full bg-scrim px-2 py-[3px] text-2xs font-medium text-on-scrim">
          <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
          {result ? strings.updating : status === 'working' ? strings.working : strings.waiting}
        </span>
      )}
      {failed && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bad-bg p-4 text-center text-sm text-bad"
        >
          <CircleAlert aria-hidden="true" className="size-6" />
          <strong className="font-semibold">{strings.failed}</strong>
          {fileJob?.job.error && <span>{fileJob.job.error}</span>}
          <Button size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            {uiStrings.retry}
          </Button>
        </div>
      )}
    </div>
  );
}

function Stats({ file, fileJob }: { file: IntakeFile; fileJob: FileJob | undefined }) {
  const result = fileJob?.current ? fileJob.result : undefined;
  const source = sourceSize(file);
  const change = result ? sizeChange(file.size, result.bytes) : undefined;
  const resized =
    result !== undefined &&
    source !== undefined &&
    (result.width !== source.width || result.height !== source.height);
  const notes = result
    ? resultNotes(result, { bytes: file.size, resized, heic: file.kind === 'heic' })
    : [];

  return (
    <>
      <dl className="m-0 grid grid-cols-3 gap-2" data-testid="stats">
        <Stat
          label={strings.original}
          value={formatBytes(file.size)}
          sub={source ? strings.dims(source.width, source.height) : undefined}
        />
        <Stat
          label={strings.result}
          value={result ? formatBytes(result.bytes) : strings.sizeUnknown}
          sub={result ? strings.dims(result.width, result.height) : undefined}
          testId="result-stat"
        />
        <Stat
          label={strings.change}
          value={
            !change
              ? strings.sizeUnknown
              : change.kind === 'smaller'
                ? strings.smaller(change.percent)
                : change.kind === 'larger'
                  ? strings.larger(change.percent)
                  : strings.same
          }
          tone={change?.kind === 'smaller' ? 'ok' : change?.kind === 'larger' ? 'warn' : undefined}
        />
      </dl>
      {notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="result-notes">
          {notes.map((note) => (
            <li key={note.id}>
              {note.tone === 'warn' ? (
                <Note icon={TriangleAlert} className="bg-warn-bg text-warn [&>svg]:text-warn">
                  {note.text}
                </Note>
              ) : (
                <Note>{note.text}</Note>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'warn';
  testId?: string;
}) {
  return (
    <div className="min-w-0 rounded-control bg-sunk px-3 py-2.5" data-testid={testId}>
      <dt className="text-xs text-faint">{label}</dt>
      <dd
        className={cn(
          'm-0 text-base font-semibold tabular-nums',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </dd>
      {sub && <dd className="m-0 truncate font-mono text-xs text-muted">{sub}</dd>}
    </div>
  );
}
