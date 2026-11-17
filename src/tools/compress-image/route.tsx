// P14 — Compress image (IMG-04 to IMG-07, D24): drop photos, see the result live with a
// before/after slider, and get smaller files that still look crisp. Every file runs through the
// image worker via the shared queue; the selected file goes first.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { IntakeFile } from '@/core/contracts/intake';
import { useQueue } from '@/core/queue';
import { useToolPage } from '@/app/use-tool-page';
import { usePendingFiles } from '@/app/pending-files';
import { ExportBar, type ExportKind } from '@/features/export';
import {
  clearPresetOnChange,
  DimsPreview,
  FormatSelect,
  MetadataSelect,
  PresetChips,
  PresetsHeading,
  QualityOrTarget,
  ResizeFields,
} from '@/features/image-settings';
import { DropZone, toIntakeFiles, useFileList, usePasteTarget } from '@/features/intake';
import { useToolSettings } from '@/features/settings';
import { PanelDivider, ToolEmptyState, ToolPage, Workspace } from '@/features/tool-layout';
import { track } from '@/lib/analytics';
import { toast } from '@/ui';
import { downloadNames } from './format';
import { resultNotes, type ResultNote } from './notes';
import {
  ACCEPT,
  COMPRESS_DEFAULTS,
  COMPRESS_PRESETS,
  compressSchema,
  jobOptions,
  optionsKey,
  presetPatch,
  PREVIEW_DEBOUNCE_MS,
  recommendedSide,
  SAMPLE,
  TOOL_ID,
  withQualityFlag,
  type CompressSettings,
  type JobOptions,
} from './settings';
import { Stage, type Shown } from './stage';
import { compressStrings as t } from './strings';
import { useCompressJobs } from './use-compress-jobs';
import { useSizeSuggestion } from './use-size-suggestion';

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The result on screen with an object URL for it. The URL is made in an effect and revoked when
 * the next result replaces it or the page goes; until then the previous result stays shown (so
 * the slider never flashes empty), and callers compare `result` to know whether it is current.
 */
function useShownResult(item: Omit<Shown, 'url'> | null): Shown | null {
  const [store] = useState(() => createStore<{ shown: Shown | null }>(() => ({ shown: null })));
  useEffect(() => {
    if (!item) return;
    const url = URL.createObjectURL(item.result.blob);
    store.setState({ shown: { ...item, url } });
    return () => URL.revokeObjectURL(url);
  }, [item, store]);
  return useStore(store, (s) => s.shown);
}

/** True once the page has hydrated (e2e tests wait for it before adding files). */
const noSubscribe = () => () => undefined;
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** No results to export yet (stable, so the export bar keeps its state between renders). */
const NO_OUTPUTS: ReadonlyArray<{ blob: Blob; name: string }> = [];

export default function CompressImageRoute() {
  const page = useToolPage();
  const [settings, update, reset] = useToolSettings<CompressSettings>(
    TOOL_ID,
    COMPRESS_DEFAULTS,
    compressSchema,
  );
  const change = clearPresetOnChange<CompressSettings>((patch) => update(withQualityFlag(patch)));

  const files = useFileList(TOOL_ID, (s) => s.files);
  const addToList = useFileList(TOOL_ID, (s) => s.add);
  const removeFromList = useFileList(TOOL_ID, (s) => s.remove);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = files.find((f) => f.id === selectedId) ?? files[0] ?? null;
  const [sampleBusy, setSampleBusy] = useState(false);
  const hydrated = useHydrated();

  const addFiles = (incoming: readonly IntakeFile[]) => {
    const added = addToList(incoming, { accept: ACCEPT });
    const last = added[added.length - 1];
    if (last) setSelectedId(last.id);
  };
  const addRaw = async (raw: File[]) => addFiles(await toIntakeFiles(raw));

  usePendingFiles(TOOL_ID, (pending) => void addRaw(pending));
  usePasteTarget((pasted) => void addRaw(pasted), files.length > 0);

  // Settings → pipeline options. The live key says what the screen should show; the settled key
  // (250 ms later) is what the jobs run with.
  const options = useMemo(() => jobOptions(settings), [settings]);
  const liveKey = optionsKey(options);
  const wanted = useMemo(() => ({ key: liveKey, options }), [liveKey, options]);
  const settled = useDebounced<{ key: string; options: JobOptions }>(wanted, PREVIEW_DEBOUNCE_MS);

  const { byFile, retry } = useCompressJobs(
    files,
    selected?.id ?? null,
    settled.options,
    settled.key,
    // One tool-run per user-started run (files added); re-runs on a settings change don't count.
    (count) => track({ name: 'tool-run', tool: TOOL_ID, files: count }),
  );
  const etaSeconds = useQueue((s) => s.stats.etaSeconds);
  const upToDate = settled.key === liveKey;

  // The last result shown for the selected file stays on screen (dimmed) while a new one is made.
  const selectedJob = selected ? byFile.get(selected.id) : undefined;
  const freshResult = selectedJob?.status === 'done' ? selectedJob.result : undefined;
  const [last, setLast] = useState<Omit<Shown, 'url'> | null>(null);
  if (selected && freshResult && last?.result !== freshResult) {
    setLast({ fileId: selected.id, result: freshResult });
  }
  const shown = useShownResult(last);
  const fresh =
    upToDate && !!freshResult && shown?.result === freshResult && shown.fileId === selected?.id;

  // Results for download, in file order, named <name>-compressed.<ext>.
  const finished = files.flatMap((f) => {
    const job = byFile.get(f.id);
    return job?.status === 'done' && job.result ? [{ file: f, result: job.result }] : [];
  });
  const failedCount = files.filter((f) => byFile.get(f.id)?.status === 'failed').length;
  const names = downloadNames(finished.map((x) => ({ sourceName: x.file.name, result: x.result })));
  const outputs = finished.map((x, i) => ({
    blob: x.result.blob,
    name: names[i] ?? x.result.name,
  }));
  const allSettled = upToDate && files.length > 0 && finished.length + failedCount === files.length;
  const currentIndex = finished.findIndex((x) => x.file.id === selected?.id);
  const current = fresh && currentIndex >= 0 ? (outputs[currentIndex] ?? null) : null;

  const onExport = (kind: ExportKind) => track({ name: 'download', tool: TOOL_ID, kind });

  // "Resize to N px" is offered only once that size was tried and fits.
  const suggestion = useSizeSuggestion(
    selected,
    fresh && shown ? shown.result : undefined,
    settings,
    settled.key,
  );
  const notes: ResultNote[] =
    fresh && shown && selected
      ? resultNotes(shown.result, selected.size, settings, suggestion)
      : [];
  const metadataJpegOnly = fresh && shown?.result.notes.includes('metadata-jpeg-only');

  const remove = (id: string) => {
    const index = files.findIndex((f) => f.id === id);
    const next = files[index + 1] ?? files[index - 1];
    removeFromList(id);
    setSelectedId(next?.id ?? null);
  };

  const trySample = async () => {
    setSampleBusy(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${SAMPLE.path}`);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      await addRaw([new File([blob], SAMPLE.name, { type: 'image/jpeg', lastModified: 0 })]);
    } catch {
      toast(t.sampleFailed);
    } finally {
      setSampleBusy(false);
    }
  };

  const graphic = !!(shown && shown.fileId === selected?.id && shown.result.graphic);

  return (
    <ToolPage
      meta={page}
      hasFiles={selected !== null}
      empty={
        <ToolEmptyState
          dropZone={
            <div data-testid="compress-drop" data-live={hydrated || undefined}>
              <DropZone accept={ACCEPT} multiple pasteHint onFiles={addFiles} />
            </div>
          }
          sampleLabel={t.trySample}
          sampleBusy={sampleBusy}
          onSample={() => void trySample()}
        />
      }
      workspace={
        selected && (
          <Workspace
            main={
              <Stage
                files={files}
                selected={selected}
                onSelect={setSelectedId}
                byFile={byFile}
                shown={shown}
                fresh={fresh}
                notes={notes}
                onNoteAction={(note) => note.action && change(note.action.patch)}
                onAdd={(raw) => void addRaw(raw)}
                onRemove={remove}
                onRetry={retry}
                progress={
                  files.length > 1
                    ? {
                        done: finished.length,
                        failed: failedCount,
                        total: files.length,
                        etaSeconds,
                      }
                    : null
                }
              />
            }
            panelTitle={<PresetsHeading />}
            panelIntro={
              <PresetChips
                presets={COMPRESS_PRESETS}
                value={settings.preset}
                onSelect={(preset) => update(presetPatch(preset))}
              />
            }
            onReset={reset}
            panel={
              <>
                <PanelDivider />
                <QualityOrTarget value={settings} onChange={change} />
                <PanelDivider />
                <FormatSelect value={settings} onChange={change} graphic={graphic} />
                <PanelDivider />
                <ResizeFields
                  optional
                  modes={['longest', 'width', 'height', 'percent']}
                  value={settings}
                  onChange={change}
                  preview={
                    <DimsPreview
                      optional
                      source={
                        selected.width && selected.height
                          ? { width: selected.width, height: selected.height }
                          : null
                      }
                      values={settings}
                      minRecommendedSide={recommendedSide(settings)}
                    />
                  }
                />
                <PanelDivider />
                <MetadataSelect
                  value={settings}
                  onChange={change}
                  format={settings.format}
                  jpegOnlyNote={settings.format === 'keep' ? !!metadataJpegOnly : undefined}
                />
              </>
            }
            actions={
              <ExportBar
                variant="panel"
                folder="wide"
                files={allSettled ? outputs : NO_OUTPUTS}
                single={current}
                count={allSettled ? outputs.length : files.length}
                zipName={t.zipName}
                onExport={onExport}
              />
            }
          />
        )
      }
    />
  );
}
