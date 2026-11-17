// Organize pages (PDF-04, P20): one PDF → page grid; reorder, rotate and delete pages with undo
// and redo; "Save PDF" runs `organize` in the PDF worker through the shared queue.
import { CircleAlert, FileCheck2, LoaderCircle, Save, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { usePendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import type { IntakeFile } from '@/core/contracts/intake';
import type { OrganizeInput, PdfInfo, PdfResult } from '@/core/contracts/pdf';
import { useQueue } from '@/core/queue';
import { readPdfInfo } from '@/engines/pdf';
import { ExportBar } from '@/features/export';
import { DropZone, keepAccepted, toIntakeFiles, useFileList } from '@/features/intake';
import {
  Field,
  PanelDivider,
  PanelSection,
  ToolEmptyState,
  ToolPage,
  Workspace,
} from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { Button, Card, Helper, Input, Label, Note, ProgressBar } from '@/ui';
import { PageGrid } from './page-grid';
import { samePages, toOrganizePages, type PageItem } from './pages';
import { formatBytes, organizeStrings as t } from './strings';
import { HistoryButtons, Toolbar } from './toolbar';
import { useOrganizer } from './use-organizer';

const TOOL = 'organize-pdf';
const ACCEPT = ['pdf'] as const;
const noSubscribe = () => () => {};

type InfoState =
  { status: 'reading' } | { status: 'ready'; info: PdfInfo } | { status: 'error'; message: string };

function isPdfResult(value: unknown): value is PdfResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { files?: unknown }).files)
  );
}

const baseName = (name: string) => name.replace(/\.pdf$/i, '') || 'document';

export default function ToolRoute() {
  const page = useToolPage();
  const file = useFileList(TOOL, (s) => s.files[0]);
  const { add, clear } = useFileList(TOOL);
  // The page takes files once its code has loaded (end-to-end tests wait for this).
  const live = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  const take = (files: readonly IntakeFile[]) => {
    const first = files[0];
    if (!first) return;
    clear();
    add([first]);
  };
  usePendingFiles(TOOL, (raw) => {
    void toIntakeFiles(raw).then((files) => take(keepAccepted(files, ACCEPT)));
  });

  return (
    <div data-testid="organize-pdf" data-live={live || undefined} className="contents">
      <ToolPage
        meta={page}
        hasFiles={!!file}
        empty={
          <ToolEmptyState
            dropZone={
              <DropZone
                accept={ACCEPT}
                onFiles={take}
                title={t.dropTitle}
                subtitle={t.dropSubtitle}
              />
            }
          />
        }
        workspace={file && <Organize key={file.id} file={file} onReplace={take} onRemove={clear} />}
      />
    </div>
  );
}

function Organize({
  file,
  onReplace,
  onRemove,
}: {
  file: IntakeFile;
  onReplace: (files: IntakeFile[]) => void;
  onRemove: () => void;
}) {
  const [state, setState] = useState<InfoState>({ status: 'reading' });

  useEffect(() => {
    let live = true;
    readPdfInfo(file.file).then(
      (info) => {
        if (!live) return;
        if (info.encrypted) setState({ status: 'error', message: t.encrypted });
        else if (info.pages === 0) setState({ status: 'error', message: t.noPagesInFile });
        else setState({ status: 'ready', info });
      },
      () => {
        if (live) setState({ status: 'error', message: t.unreadable });
      },
    );
    return () => {
      live = false;
    };
  }, [file]);

  if (state.status === 'ready') {
    return <Editor file={file} info={state.info} onRemove={onRemove} />;
  }

  const main = (
    <Card className="flex flex-col items-center gap-4 px-5 py-10 text-center">
      {state.status === 'reading' ? (
        <p role="status" className="m-0 flex items-center gap-2 text-muted">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {t.reading}
        </p>
      ) : (
        <>
          <p role="alert" className="m-0 flex max-w-[460px] items-start gap-2 text-left text-bad">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong className="block text-fg">{file.name}</strong>
              {state.message}
            </span>
          </p>
          <DropZone
            accept={ACCEPT}
            size="small"
            onFiles={onReplace}
            title={t.chooseAnother}
            className="w-full max-w-[460px]"
          />
        </>
      )}
    </Card>
  );

  return (
    <Workspace
      main={main}
      panelTitle={t.panelTitle}
      panel={
        <Button variant="ghost" onClick={onRemove} className="self-start">
          <X aria-hidden="true" />
          {t.removeFile}
        </Button>
      }
    />
  );
}

interface Run {
  jobId: string;
  /** The page list that was saved; any later edit makes the result out of date. */
  pages: PageItem[];
}

function Editor({
  file,
  info,
  onRemove,
}: {
  file: IntakeFile;
  info: PdfInfo;
  onRemove: () => void;
}) {
  const organizer = useOrganizer(info.pages);
  const { pages, message } = organizer;
  const nameId = useId();
  const [name, setName] = useState(() => `${baseName(file.name)}${t.nameSuffix}`);
  const [run, setRun] = useState<Run | null>(null);
  const job = useQueue((s) => (run ? s.jobs.find((j) => j.id === run.jobId) : undefined));
  const resultRef = useRef<HTMLDivElement>(null);
  const jobIds = useRef(new Set<string>());

  // Jobs belong to this page: drop them (and their result blobs) when it closes.
  useEffect(() => {
    const ids = jobIds.current;
    return () => {
      const queue = useQueue.getState();
      for (const id of ids) queue.remove(id);
    };
  }, []);

  const current = job && run && samePages(run.pages, pages) ? job : undefined;
  const working = current?.status === 'waiting' || current?.status === 'working';
  const result =
    current?.status === 'done' && isPdfResult(current.result) ? current.result.files[0] : undefined;

  // Bring the result into view (on phones it sits under the page grid).
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [result]);

  // Ctrl/⌘ + Z and Ctrl/⌘ + Shift + Z (or Ctrl + Y) anywhere on the page, except in text fields.
  const { undo, redo } = organizer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select'))
      )
        return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const save = () => {
    if (pages.length === 0 || working) return;
    if (run) {
      useQueue.getState().remove(run.jobId);
      jobIds.current.delete(run.jobId);
    }
    const input: OrganizeInput = {
      file: { blob: file.file, name: file.name },
      pages: toOrganizePages(pages),
      outName: name.trim() || `${baseName(file.name)}${t.nameSuffix}`,
    };
    const queue = useQueue.getState();
    const [jobId] = queue.add('pdf', 'organize', [{ label: file.name, input }]);
    if (!jobId) return;
    jobIds.current.add(jobId);
    setRun({ jobId, pages });
    queue.start();
    track({ name: 'tool-run', tool: TOOL, files: 1 });
  };

  const percent = Math.round((current?.progress ?? 0) * 100);

  const main = (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3.5 py-3">
        <strong className="min-w-0 truncate">
          {file.name}{' '}
          <span className="font-normal text-muted">· {t.summary(pages.length, info.pages)}</span>
        </strong>
        <span className="flex items-center gap-2 text-ui text-faint">
          <span>
            {t.selectedCount(organizer.selected.size)} · {t.dragHint}
          </span>
          <HistoryButtons organizer={organizer} disabled={working} />
        </span>
      </div>
      <div className="border-b border-line px-2 py-1.5">
        <Toolbar organizer={organizer} disabled={working} />
      </div>
      {pages.length === 0 ? (
        <p className="m-0 px-3.5 py-10 text-center text-muted">{t.allDeleted}</p>
      ) : (
        <PageGrid
          file={file.file}
          organizer={organizer}
          sizes={info.pageSizes}
          disabled={working}
        />
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {message.text ? <span key={message.n}>{message.text}</span> : null}
      </span>
    </Card>
  );

  const panel = (
    <>
      <PanelSection>
        <Field>
          <Label htmlFor={nameId}>{t.fileName}</Label>
          <div className="relative flex items-center">
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="pr-11"
              spellCheck={false}
            />
            <span className="pointer-events-none absolute right-2.5 text-ui text-faint">.pdf</span>
          </div>
        </Field>
        <Note>{t.limits}</Note>
      </PanelSection>
      <PanelDivider />
      <PanelSection>
        <span className="text-ui font-medium text-muted">{t.keysTitle}</span>
        <Helper>{t.keysMouse}</Helper>
        <Helper>{t.keysTouch}</Helper>
        <Helper>{t.keysKeyboard}</Helper>
      </PanelSection>
      {(working || current) && <PanelDivider />}
      {working && (
        <PanelSection>
          <span className="text-ui font-medium text-muted">{t.saving(percent)}</span>
          <ProgressBar value={current?.progress ?? 0} label={t.savingLabel} size="lg" />
        </PanelSection>
      )}
      {current?.status === 'failed' && (
        <p role="alert" className="m-0 flex items-start gap-2 text-sm text-bad">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="block">{t.failed}</strong>
            {current.error}
          </span>
        </p>
      )}
      {current?.status === 'cancelled' && (
        <p role="status" className="m-0 text-sm text-muted">
          {t.cancelled}
        </p>
      )}
      {result && (
        <div ref={resultRef} className="flex flex-col gap-3">
          <div
            role="status"
            className="flex items-center gap-3.5 rounded-xl bg-ok-bg p-4 text-ok"
            data-testid="organize-result"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-card">
              <FileCheck2 aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0 text-ui">
              <strong className="block truncate text-fg">{result.name}</strong>
              {t.resultLine(result.pages, formatBytes(file.size), formatBytes(result.blob.size))}
            </span>
          </div>
          <ExportBar
            files={[result]}
            onExport={(kind) => track({ name: 'download', tool: TOOL, kind })}
          />
        </div>
      )}
      <PanelDivider />
      <Button variant="ghost" onClick={onRemove} className="self-start" disabled={working}>
        <X aria-hidden="true" />
        {t.removeFile}
      </Button>
    </>
  );

  const actions = working ? (
    <>
      <Button variant="primary" size="lg" block disabled>
        <LoaderCircle aria-hidden="true" className="animate-spin" />
        {t.saving(percent)}
      </Button>
      <Button size="lg" block onClick={() => current && useQueue.getState().cancel(current.id)}>
        {t.cancel}
      </Button>
    </>
  ) : result ? undefined : (
    <>
      {pages.length === 0 && <Helper className="max-[880px]:hidden">{t.noPagesKept}</Helper>}
      <Button variant="primary" size="lg" block onClick={save} disabled={pages.length === 0}>
        <Save aria-hidden="true" />
        {current?.status === 'failed' ? t.retry : t.save}
      </Button>
    </>
  );

  return <Workspace main={main} panelTitle={t.panelTitle} panel={panel} actions={actions} />;
}
