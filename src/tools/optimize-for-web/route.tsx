// P16 — Optimize for web (IMG-06, IMG-07, D24): pick where the images go, drop them, download small,
// sharp, private files. Sizes, quality and metadata come from P12's web presets; the page only
// picks a destination and a format.
import { Check, LoaderCircle, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { usePendingFiles } from '@/app/pending-files';
import { useToolPage } from '@/app/use-tool-page';
import { useQueue } from '@/core/queue';
import { downloadBlob, ExportBar } from '@/features/export';
import { DropZone, toIntakeFiles, useFileList } from '@/features/intake';
import { useToolSettings } from '@/features/settings';
import {
  PanelDivider,
  PanelSection,
  ResponsiveLabel,
  ToolEmptyState,
  ToolPage,
  Workspace,
} from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { Button, Card, ProgressBar } from '@/ui';
import { DestinationPicker } from './destination-picker';
import { FileRow } from './file-row';
import { FormatPicker } from './format-picker';
import { formatBytes, formatTimeLeft } from '@/tools/_shared';
import { webNames } from './result';
import { OPTIMIZE_DEFAULTS, optimizeSchema, TOOL_ID } from './settings';
import { optimizeStrings as t } from './strings';
import { useOptimizeRun } from './use-optimize-run';

export default function ToolRoute() {
  const page = useToolPage();
  const { files, add, remove, clear } = useFileList(TOOL_ID);
  const [settings, update, reset] = useToolSettings(TOOL_ID, OPTIMIZE_DEFAULTS, optimizeSchema);
  const jobs = useOptimizeRun(files, settings);
  const etaSeconds = useQueue((s) => s.stats.etaSeconds);

  usePendingFiles(TOOL_ID, (pending) => {
    void toIntakeFiles(pending).then((intake) => add(intake, { accept: page.accepts }));
  });

  // Finished results in file order, named <name>-web.<ext>.
  const { outputs, outNames } = useMemo(() => {
    const done = files.flatMap((f) => {
      const job = jobs.get(f.id);
      return job?.status === 'done' && job.result ? [{ fileId: f.id, result: job.result }] : [];
    });
    const names = webNames(done.map((d) => d.result.name));
    return {
      outputs: done.map((d, i) => ({ blob: d.result.blob, name: names[i] ?? d.result.name })),
      outNames: new Map(done.map((d, i) => [d.fileId, names[i] ?? d.result.name])),
    };
  }, [files, jobs]);

  let doneCount = 0;
  let failedCount = 0;
  let activeCount = 0;
  let progressSum = 0;
  let inBytes = 0;
  let outBytes = 0;
  for (const f of files) {
    const job = jobs.get(f.id);
    if (!job || job.status === 'waiting') activeCount++;
    else if (job.status === 'working') {
      activeCount++;
      progressSum += job.progress;
    } else {
      progressSum += 1;
      if (job.status === 'failed') failedCount++;
      if (job.status === 'done' && job.result) {
        doneCount++;
        inBytes += f.size;
        outBytes += job.result.bytes;
      }
    }
  }
  const running = activeCount > 0;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const savedPercent = inBytes > 0 ? Math.round((1 - outBytes / inBytes) * 100) : 0;

  const dropZone = (
    <DropZone
      accept={page.accepts}
      multiple
      pasteHint
      title={files.length > 0 ? t.dropMore : t.dropTitle}
      size={files.length > 0 ? 'small' : 'big'}
      onFiles={(intake) => add(intake)}
    />
  );

  const main = (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
          <strong className="text-sm" data-testid="files-heading">
            {t.filesHeading(files.length, formatBytes(totalBytes))}
          </strong>
          <Button size="sm" variant="ghost" onClick={clear} disabled={running}>
            <Trash2 aria-hidden="true" />
            {t.clear}
          </Button>
        </div>
        <ul aria-label={t.filesLabel} className="m-0 list-none p-0">
          {files.map((file) => {
            const job = jobs.get(file.id);
            const outName = outNames.get(file.id);
            return (
              <FileRow
                key={file.id}
                file={file}
                job={job}
                destination={settings.destination}
                outName={outName}
                canRemove={job?.status !== 'working'}
                onRemove={() => remove(file.id)}
                onRetry={() => {
                  if (!job) return;
                  useQueue.getState().retry(job.id);
                  useQueue.getState().start();
                }}
                onDownload={() => {
                  if (job?.result) {
                    downloadBlob(job.result.blob, outName ?? job.result.name);
                    track({ name: 'download', tool: TOOL_ID, kind: 'single' });
                  }
                }}
                onUseJpeg={() => update({ format: 'jpeg' })}
              />
            );
          })}
        </ul>
        <div
          data-testid="run-summary"
          className="flex flex-wrap items-center justify-between gap-3 rounded-b-card border-t border-line bg-sunk px-3.5 py-3 text-sm text-muted"
        >
          {running ? (
            <>
              <span role="status">
                <strong className="text-fg">
                  {t.working(doneCount + failedCount, files.length)}
                </strong>{' '}
                · <span data-testid="time-left">{formatTimeLeft(etaSeconds)}</span>
              </span>
              <ProgressBar
                value={files.length > 0 ? progressSum / files.length : 0}
                label={t.runProgress}
                className="w-[140px]"
              />
            </>
          ) : (
            <span role="status">
              <strong className="text-fg">{t.summaryDone(doneCount)}</strong>
              {failedCount > 0 && (
                <span className="text-bad"> · {t.summaryFailed(failedCount)}</span>
              )}
              {doneCount > 0 && (
                <>
                  {' · '}
                  {formatBytes(inBytes)} →{' '}
                  <strong className="text-ok">{formatBytes(outBytes)}</strong>
                  {savedPercent > 0 && <> ({t.summarySaved(savedPercent)})</>}
                </>
              )}
            </span>
          )}
        </div>
      </Card>
      {dropZone}
    </div>
  );

  const panel = (
    <>
      <PanelDivider />
      <FormatPicker value={settings.format} onChange={(format) => update({ format })} />
      <PanelDivider />
      <PanelSection>
        <span className="text-ui font-medium text-muted">{t.alwaysTitle}</span>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-ui">
          {[
            t.always.srgb,
            t.always.metadata,
            ...(settings.format === 'jpeg' ? [t.always.progressive] : []),
            t.always.noEnlarge,
          ].map((text) => (
            <li key={text} className="flex items-start gap-2">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ok" />
              {text}
            </li>
          ))}
        </ul>
      </PanelSection>
    </>
  );

  const actions = running ? (
    <Button variant="primary" size="lg" block disabled>
      <LoaderCircle aria-hidden="true" className="animate-spin" />
      <ResponsiveLabel
        wide={t.working(doneCount + failedCount, files.length)}
        narrow={t.workingShort(doneCount + failedCount, files.length)}
      />
    </Button>
  ) : (
    // In the phone bar the export buttons share the row and the bar grows for the ZIP progress.
    <div className="max-[880px]:h-auto! max-[880px]:px-0!">
      <ExportBar
        files={outputs}
        zipName={t.zipName}
        onExport={(kind) => track({ name: 'download', tool: TOOL_ID, kind })}
        className="[&>div:first-child>button]:flex-1 min-[880px]:[&>div:first-child>button]:basis-full"
      />
    </div>
  );

  return (
    <ToolPage
      meta={page}
      description={t.description}
      hasFiles={files.length > 0}
      empty={<ToolEmptyState dropZone={dropZone} />}
      workspace={
        <Workspace
          main={main}
          panelTitle={t.destinationTitle}
          panelIntro={
            <DestinationPicker
              value={settings.destination}
              format={settings.format}
              onChange={(destination) => update({ destination })}
            />
          }
          panel={panel}
          onReset={reset}
          actions={actions}
        />
      }
    />
  );
}
