/**
 * Tool layout demo (P13) — a dev-only review page, not pre-rendered and not linked from the app.
 * Shows the Compress and Bulk workspaces from the prototype built from the shared layout and
 * settings controls, plus the empty state. Settings are remembered like on a real tool page.
 *
 * Route registration belongs to P10 (src/app/routes.ts), only in development:
 *   route('dev/layout', '../features/tool-layout/demo.tsx')
 *
 * The sample files, presets and labels here are demo content for reviewers, so they aren't in
 * strings.ts. Real tools take presets from P12 and text from their own strings.ts.
 */
import { Download, FolderArchive, Play, Upload } from 'lucide-react';
import { useState } from 'react';
import type { WebPreset } from '@/core/contracts/image';
import type { ToolMeta } from '@/core/contracts/tools';
import { fitSize, type Size } from '@/core/sizing';
import {
  applyPreset,
  clearPresetOnChange,
  DimsPreview,
  FormatSelect,
  IMAGE_SETTINGS_DEFAULTS,
  imageSettingsSchema,
  MetadataSelect,
  planSize,
  PresetChips,
  PresetsHeading,
  QualityOrTarget,
  QualitySlider,
  RenamePattern,
  ResizeFields,
  type ImageSettingsValues,
} from '@/features/image-settings';
import { useToolSettings } from '@/features/settings';
import { cn } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Kbd,
  Segmented,
  strings as uiStrings,
  ThemeToggle,
} from '@/ui';
import { PanelDivider } from './panel';
import { ResponsiveLabel } from './responsive-label';
import { ToolEmptyState, ToolPage, containerClass } from './tool-page';
import { Workspace } from './workspace';

export function meta() {
  return [{ title: 'Tool layout — Snap Convert' }, { name: 'robots', content: 'noindex' }];
}

type View = 'compress' | 'bulk' | 'empty';

const COMPRESS: Pick<ToolMeta, 'name' | 'group' | 'short'> = {
  name: 'Compress image',
  group: 'Images',
  short: 'Smaller files, same look. Set quality or a target size.',
};
const BULK: Pick<ToolMeta, 'name' | 'group' | 'short'> = {
  name: 'Bulk resize & compress',
  group: 'Images',
  short: 'Hundreds of images at once, downloaded as a ZIP.',
};

// Sample presets matching docs/03-features.md (the real list comes from P12).
const PRESETS: WebPreset[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    longestSide: 2048,
    format: 'jpeg',
    quality: 80,
    metadata: 'strip-all',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    longestSide: 2048,
    format: 'jpeg',
    quality: 80,
    metadata: 'strip-all',
  },
  {
    id: 'blog',
    name: 'Blog hero',
    longestSide: 1600,
    format: 'jpeg',
    quality: 80,
    metadata: 'strip-all',
  },
  {
    id: 'email',
    name: 'Email',
    longestSide: 800,
    format: 'jpeg',
    quality: 80,
    metadata: 'strip-all',
  },
  {
    id: 'thumbnail',
    name: 'Thumbnail',
    longestSide: 400,
    format: 'jpeg',
    quality: 80,
    metadata: 'strip-all',
  },
];
/** Sample of P12's minRecommendedSide: full-width uses want 1200 px or more. */
const FULL_WIDTH: ReadonlyArray<WebPreset['id']> = ['wordpress', 'shopify', 'blog'];

interface SampleFile extends Size {
  name: string;
  size: string;
}
const SAMPLES: SampleFile[] = [
  { name: 'IMG_2041.jpg', width: 4032, height: 3024, size: '3.4 MB' },
  { name: 'IMG_2042.jpg', width: 3024, height: 4032, size: '3.1 MB' },
  { name: 'product-front.png', width: 3000, height: 3000, size: '9.8 MB' },
  { name: 'panorama-beach.jpg', width: 9000, height: 2600, size: '7.2 MB' },
  { name: 'logo-old.png', width: 800, height: 600, size: '0.4 MB' },
  { name: 'thumb-small.jpg', width: 400, height: 300, size: '0.05 MB' },
];

const COMPRESS_DEFAULTS: ImageSettingsValues = {
  ...IMAGE_SETTINGS_DEFAULTS,
  resizeEnabled: false,
};
const BULK_DEFAULTS: ImageSettingsValues = { ...IMAGE_SETTINGS_DEFAULTS, format: 'jpeg' };

const extension = (name: string) => name.split('.').pop()?.toLowerCase() ?? 'jpg';
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
const outExtension = (format: ImageSettingsValues['format'], name: string) =>
  format === 'keep' ? extension(name) : format === 'jpeg' ? 'jpg' : format;

/** An aspect-correct shape for a file thumbnail (size from the sizing rule). */
function Shape({ source, box }: { source: Size; box: number }) {
  const shape = fitSize(source, { mode: 'longest', value: box, upscale: true });
  return (
    <span
      aria-hidden="true"
      className="block rounded-[3px] bg-accent-shape"
      style={{ width: shape.width, height: shape.height }}
    />
  );
}

function CompressDemo({ graphic }: { graphic: boolean }) {
  const [settings, update, reset] = useToolSettings(
    'dev-layout-compress',
    COMPRESS_DEFAULTS,
    imageSettingsSchema,
  );
  const change = clearPresetOnChange(update);
  const files = SAMPLES.slice(0, 3);
  const [selected, setSelected] = useState(0);
  const file = files[selected] ?? SAMPLES[0]!;

  const main = (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {files.map((f, i) => (
          <button
            key={f.name}
            type="button"
            aria-label={f.name}
            aria-current={i === selected}
            onClick={() => setSelected(i)}
            className={cn(
              'grid size-14 shrink-0 cursor-pointer place-items-center rounded-lg border-2 border-transparent bg-sunk p-0',
              'aria-[current=true]:border-accent',
            )}
          >
            <Shape source={f} box={40} />
          </button>
        ))}
      </div>
      <div
        className="relative mx-auto grid max-h-[62vh] w-full place-items-center overflow-hidden rounded-control bg-checker"
        style={{ aspectRatio: `${file.width} / ${file.height}` }}
      >
        <span className="absolute inset-0 opacity-80 bg-accent-shape" />
        <span className="absolute top-2.5 left-2.5 rounded-full bg-scrim px-2 py-[3px] text-2xs font-medium text-on-scrim">
          {uiStrings.compareBefore}
        </span>
        <span className="absolute top-2.5 right-2.5 rounded-full bg-scrim px-2 py-[3px] text-2xs font-medium text-on-scrim">
          {uiStrings.compareAfter}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Original', file.size],
          ['New size', '—'],
          ['Saved', '—'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-control bg-sunk px-3 py-2.5">
            <div className="text-xs text-faint">{k}</div>
            <div className="text-base font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="truncate text-sm font-medium">{file.name}</div>
    </Card>
  );

  return (
    <ToolPage
      meta={COMPRESS}
      hasFiles
      workspace={
        <Workspace
          main={main}
          panelTitle={<PresetsHeading />}
          panelIntro={
            <PresetChips
              presets={PRESETS}
              value={settings.preset}
              onSelect={(preset) => update(applyPreset(preset))}
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
                    source={file}
                    values={settings}
                    minRecommendedSide={
                      settings.preset && FULL_WIDTH.includes(settings.preset) ? 1200 : undefined
                    }
                  />
                }
              />
              <PanelDivider />
              <MetadataSelect value={settings} onChange={change} format={settings.format} />
            </>
          }
          actions={
            <>
              <Button variant="primary" size="lg" block>
                <Download aria-hidden="true" />
                {uiStrings.download}
              </Button>
              <Button block size="lg">
                <FolderArchive aria-hidden="true" />
                <ResponsiveLabel
                  wide={uiStrings.downloadAllCountZip(files.length)}
                  narrow="All (ZIP)"
                />
              </Button>
            </>
          }
        />
      }
    />
  );
}

function BulkDemo({ graphic }: { graphic: boolean }) {
  const [settings, update, reset] = useToolSettings(
    'dev-layout-bulk',
    BULK_DEFAULTS,
    imageSettingsSchema,
  );
  const first = SAMPLES[0]!;
  const firstPlan = planSize(first, settings);

  const main = (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
        <strong>
          {SAMPLES.length} files <span className="font-normal text-muted">· 24 MB</span>
        </strong>
      </div>
      <ul className="m-0 list-none p-0">
        {SAMPLES.map((f) => {
          const plan = planSize(f, settings);
          const [from, to] = (plan?.text ?? '').split(' → ');
          return (
            <li
              key={f.name}
              className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
            >
              <span className="grid size-11 place-items-center overflow-hidden rounded-lg bg-sunk">
                <Shape source={f} box={32} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{f.name}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted">
                  <span>
                    {from} <span className="text-accent">→ {to}</span>
                    {plan?.notEnlarged && !plan.padded && (
                      <span className="text-faint"> not enlarged</span>
                    )}
                    {plan?.padded && <span className="text-faint"> padded</span>}
                    {plan?.cropped && <span className="text-faint"> cropped</span>}
                  </span>
                  <span>{f.size}</span>
                </span>
              </span>
              <span className="text-xs text-faint">Waiting</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-card border-t border-line bg-sunk p-3.5 text-muted">
        <span>
          Estimated: 24 MB → about <strong className="text-fg">3.1 MB</strong>
        </span>
      </div>
    </Card>
  );

  return (
    <ToolPage
      meta={BULK}
      hasFiles
      workspace={
        <Workspace
          main={main}
          panelTitle="Settings for all files"
          onReset={reset}
          panel={
            <>
              <ResizeFields value={settings} onChange={update} />
              <PanelDivider />
              <div className="flex items-start gap-2.5 *:min-w-0 *:flex-1">
                <FormatSelect value={settings} onChange={update} graphic={graphic} compact />
                <QualitySlider value={settings} onChange={update} compact className="pt-0.5" />
              </div>
              <RenamePattern
                value={settings}
                onChange={update}
                example={{
                  name: baseName(first.name),
                  width: firstPlan?.output.width,
                  height: firstPlan?.output.height,
                  n: 1,
                  format: outExtension(settings.format, first.name),
                }}
              />
              <MetadataSelect
                value={settings}
                onChange={update}
                format={settings.format}
                helper={false}
              />
            </>
          }
          actions={
            <Button variant="primary" size="lg" block>
              <Play aria-hidden="true" />
              Resize {SAMPLES.length} images
            </Button>
          }
        />
      }
    />
  );
}

function EmptyDemo() {
  const [busy, setBusy] = useState(false);
  return (
    <ToolPage
      meta={COMPRESS}
      empty={
        <ToolEmptyState
          dropZone={
            // Stand-in for P11's <DropZone>.
            <div className="flex flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-line bg-card px-5 py-9 text-center">
              <span className="grid size-[52px] place-items-center rounded-[14px] bg-accent-soft text-accent">
                <Upload aria-hidden="true" className="size-6" />
              </span>
              <span className="text-lg font-semibold">Drop images here</span>
              <Button variant="primary" className="mt-1">
                {uiStrings.chooseFiles}
              </Button>
              <span className="text-ui text-faint">JPG · PNG · WebP · AVIF · HEIC — any size</span>
              <span className="text-ui text-faint">
                {uiStrings.pasteHintPrefix} <Kbd>Ctrl</Kbd> + <Kbd>V</Kbd>
              </span>
            </div>
          }
          sampleLabel="Try with a sample photo"
          sampleBusy={busy}
          onSample={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 1200);
          }}
        />
      }
    />
  );
}

export default function ToolLayoutDemo() {
  const [view, setView] = useState<View>('compress');
  const [graphic, setGraphic] = useState(false);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className={cn(containerClass, 'flex flex-wrap items-center gap-3 pt-4')}>
        <Badge variant="accent">Dev · tool layout</Badge>
        <Segmented<View>
          label="Demo screen"
          value={view}
          onValueChange={setView}
          className="w-[260px]"
          options={[
            { value: 'compress', label: 'Compress' },
            { value: 'bulk', label: 'Bulk' },
            { value: 'empty', label: 'Empty' },
          ]}
        />
        <Checkbox
          checked={graphic}
          onCheckedChange={setGraphic}
          label="Image looks like a graphic"
        />
        <ThemeToggle className="ml-auto" />
      </div>
      {view === 'compress' && <CompressDemo graphic={graphic} />}
      {view === 'bulk' && <BulkDemo graphic={graphic} />}
      {view === 'empty' && <EmptyDemo />}
    </div>
  );
}
