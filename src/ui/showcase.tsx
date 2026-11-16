/**
 * UI kit showcase (P02) — a dev-only review page, not pre-rendered and not linked from the app.
 * Shows every component in a light and a dark column. The demo text here is sample content for
 * reviewers, so it isn't in strings.ts.
 *
 * Route registration belongs to P10 (src/app/routes.ts), e.g. only in development:
 *   route('dev/ui', '../ui/showcase.tsx')
 */
import { Check, Download, FolderArchive, Info, Lock, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from './badge';
import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { CompareSlider } from './compare-slider';
import { HelpTip } from './help-tip';
import { IconButton } from './icon-button';
import { Input } from './input';
import { Kbd } from './kbd';
import { Helper, Label } from './label';
import { Logo } from './logo';
import { Note } from './note';
import { NumberField } from './number-field';
import { ProgressBar } from './progress-bar';
import { FitFillPicture, RadioCards } from './radio-cards';
import { ResetButton } from './reset-button';
import { Segmented } from './segmented';
import { Select } from './select';
import { Slider } from './slider';
import { strings } from './strings';
import { Swatches } from './swatches';
import { ThemeToggle } from './theme-toggle';
import { toast, Toaster } from './toaster';

export function meta() {
  return [{ title: 'UI kit — Snap Convert' }, { name: 'robots', content: 'noindex' }];
}

type Mode = 'quality' | 'target';
type ResizeBy = 'longest' | 'width' | 'height' | 'percent';
type Format = 'keep' | 'jpeg' | 'png' | 'webp' | 'avif';

const DEFAULTS = {
  mode: 'quality' as Mode,
  quality: 80,
  target: 200,
  format: 'keep' as Format,
  resize: true,
  resizeBy: 'longest' as ResizeBy,
  size: 1920,
  percent: 50,
  fit: 'fit' as 'fit' | 'fill',
  pad: '#ffffff',
  strip: true,
  rename: '{name}-{width}w',
};

// Sample padding colours (data a tool passes in, not theme colours).
const PAD_OPTIONS = [
  { value: '#ffffff', label: 'White' },
  { value: '#000000', label: 'Black' },
  { value: '#f3f2f0', label: 'Light grey' },
  { value: 'transparent', label: strings.transparent },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-ui font-medium text-faint">{title}</h3>
      {children}
    </section>
  );
}

function Gallery({ theme }: { theme: 'light' | 'dark' }) {
  const [s, setS] = useState(DEFAULTS);
  const set = (patch: Partial<typeof DEFAULTS>) => setS((prev) => ({ ...prev, ...patch }));
  const [split, setSplit] = useState(50);
  const [progress] = useState(0.62);
  const id = (name: string) => `${theme}-${name}`;

  return (
    <div data-theme={theme} className="flex flex-col gap-8 bg-bg px-4 py-6 text-fg sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="leading-tight">
            <span className="block text-base font-semibold tracking-[-0.01em]">
              {strings.appName}
            </span>
            <span className="block font-mono text-2xs text-faint">{strings.byline}</span>
          </span>
        </div>
        <h2 className="m-0"><Badge variant="accent">{theme === 'light' ? 'Light theme' : 'Dark theme'}</Badge></h2>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">
            <Download aria-hidden="true" />
            {strings.download}
          </Button>
          <Button>
            <FolderArchive aria-hidden="true" />
            {strings.downloadAllZip}
          </Button>
          <Button variant="ghost">
            <Plus aria-hidden="true" />
            {strings.addFiles}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button size="sm">Small</Button>
          <Button variant="ghost" size="sm">
            <Trash2 aria-hidden="true" />
            {strings.remove}
          </Button>
          <ResetButton onClick={() => toast(strings.resetDone)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg">
            Large
          </Button>
          <Button size="lg">Large</Button>
          <Button iconOnly aria-label="Add images">
            <Plus aria-hidden="true" />
          </Button>
          <Button iconOnly size="sm" variant="ghost" aria-label="Remove file">
            <Trash2 aria-hidden="true" />
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <Button variant="primary" size="lg" block>
          <Download aria-hidden="true" />
          {strings.download}
        </Button>
        <div className="flex items-center gap-1">
          <IconButton label="Information">
            <Info aria-hidden="true" />
          </IconButton>
          <IconButton label="Remove file" size="sm">
            <Trash2 aria-hidden="true" />
          </IconButton>
          <ThemeToggle />
          <Button size="sm" onClick={() => toast('Downloaded team-photo.jpg')}>
            Show a toast
          </Button>
        </div>
      </Section>

      <Section title="Badges, notes, keys">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="accent">Soon</Badge>
          <Badge variant="ok">
            <Check aria-hidden="true" />
            182 KB
          </Badge>
          <Badge variant="warn">Larger</Badge>
          <Badge variant="bad">Failed</Badge>
        </div>
        <Note>
          Pages keep their original size and quality. Use Resize PDF to make every page the same
          size.
        </Note>
        <Note icon={Lock}>
          Proportions are locked. Images already smaller than this are left as they are.
        </Note>
        <p className="m-0 text-ui text-faint">
          {strings.pasteHintPrefix} <Kbd>Ctrl</Kbd> + <Kbd>V</Kbd>
        </p>
      </Section>

      <Section title="Progress">
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <ProgressBar value={progress} label="team-photo.jpg" />
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <ProgressBar value={0.35} size="lg" label="Merging" />
      </Section>

      <Section title="Before / after">
        <CompareSlider
          split={split}
          onSplitChange={setSplit}
          before={<div className="size-full bg-accent-shape" />}
          after={<div className="size-full bg-accent-shape opacity-60 saturate-50" />}
        />
        <Helper>
          Split: {Math.round(split)}% · drag, or focus and use the arrow keys (Shift for 10%)
        </Helper>
      </Section>

      <Section title="Settings panel">
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="m-0 text-sm font-semibold">
              Quick presets
              <HelpTip label="About quick presets">
                Sets size, format and quality for common places you upload images. You can still
                change anything after.
              </HelpTip>
            </h4>
            <ResetButton onClick={() => setS(DEFAULTS)} />
          </div>
          <hr className="m-0 w-full border-0 border-t border-line" />

          <Segmented
            label="Compression mode"
            value={s.mode}
            onValueChange={(mode) => set({ mode })}
            options={[
              { value: 'quality', label: 'By quality' },
              { value: 'target', label: 'Target file size' },
            ]}
          />
          {s.mode === 'quality' ? (
            <Slider
              label="Quality"
              tip={
                <HelpTip label="About quality">
                  Lower quality makes a smaller file. Between 75 and 85 most people can't see a
                  difference.
                </HelpTip>
              }
              value={s.quality}
              onValueChange={(quality) => set({ quality })}
              min={10}
              max={100}
              helper="80 looks the same as the original for most photos."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <span>
                <Label htmlFor={id('target')}>Make each file smaller than</Label>
                <HelpTip label="About target file size">
                  Snap Convert tries different quality levels and picks the best one that fits
                  under this size.
                </HelpTip>
              </span>
              <NumberField
                id={id('target')}
                value={s.target}
                onValueChange={(target) => set({ target })}
                min={10}
                max={100000}
                step={10}
                unit="KB"
              />
              <Helper>We find the best quality that fits. Works with JPG, WebP and AVIF.</Helper>
            </div>
          )}
          <hr className="m-0 w-full border-0 border-t border-line" />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id('format')}>Save as</Label>
            <Select
              id={id('format')}
              value={s.format}
              onValueChange={(format) => set({ format })}
              options={[
                { value: 'keep', label: 'Same as original' },
                { value: 'jpeg', label: 'JPG' },
                { value: 'png', label: 'PNG' },
                { value: 'webp', label: 'WebP' },
                { value: 'avif', label: 'AVIF' },
              ]}
            />
          </div>
          <hr className="m-0 w-full border-0 border-t border-line" />

          <div className="flex flex-col gap-2.5">
            <Checkbox
              checked={s.resize}
              onCheckedChange={(resize) => set({ resize })}
              label={<span className="font-medium">Also resize</span>}
              tip={
                <HelpTip label="About resizing">
                  Longest side: the bigger of width and height becomes this size, and the other
                  side follows to keep proportions. Images are never enlarged or stretched.
                </HelpTip>
              }
              helper="Smaller dimensions save the most space."
            />
            {s.resize && (
              <div className="flex items-center gap-2.5 *:min-w-0 *:flex-1">
                <Select
                  aria-label="Resize by"
                  value={s.resizeBy}
                  onValueChange={(resizeBy) => set({ resizeBy })}
                  options={[
                    { value: 'longest', label: 'Longest side' },
                    { value: 'width', label: 'Max width' },
                    { value: 'height', label: 'Max height' },
                    { value: 'percent', label: 'Percentage' },
                  ]}
                />
                {s.resizeBy === 'percent' ? (
                  <NumberField
                    aria-label="Percent"
                    value={s.percent}
                    onValueChange={(percent) => set({ percent })}
                    min={1}
                    max={100}
                    unit="%"
                  />
                ) : (
                  <NumberField
                    aria-label="Size"
                    value={s.size}
                    onValueChange={(size) => set({ size })}
                    min={1}
                    max={20000}
                    unit="px"
                  />
                )}
              </div>
            )}
          </div>
          <hr className="m-0 w-full border-0 border-t border-line" />

          <div className="flex flex-col gap-2.5">
            <span className="text-ui font-medium text-muted">
              How to fit the box
              <HelpTip label="About Fit and Fill">
                Fit shows the whole image and fills the empty space with a colour. Fill covers the
                whole box and trims the edges that don't fit. Neither one stretches the image.
              </HelpTip>
            </span>
            <RadioCards
              label="How to fit"
              value={s.fit}
              onValueChange={(fit) => set({ fit })}
              options={[
                {
                  value: 'fit',
                  title: 'Fit',
                  description: 'Whole image, padded',
                  picture: <FitFillPicture mode="fit" />,
                },
                {
                  value: 'fill',
                  title: 'Fill',
                  description: 'Fills box, edges cropped',
                  picture: <FitFillPicture mode="fill" />,
                },
              ]}
            />
            {s.fit === 'fit' && (
              <div className="flex flex-col gap-2.5">
                <span className="text-ui font-medium text-muted">Padding colour</span>
                <Swatches
                  label="Padding colour"
                  options={PAD_OPTIONS}
                  value={s.pad}
                  onValueChange={(pad) => set({ pad })}
                />
              </div>
            )}
          </div>
          <hr className="m-0 w-full border-0 border-t border-line" />

          <div className="flex flex-col gap-1.5">
            <span>
              <Label htmlFor={id('rename')}>File names</Label>
              <HelpTip label="About file names">
                {
                  'Words in curly brackets are filled in for each file: {name} original name, {width} and {height} new size, {n} file number, {format} file type.'
                }
              </HelpTip>
            </span>
            <Input
              id={id('rename')}
              className="font-mono"
              spellCheck={false}
              value={s.rename}
              onChange={(e) => set({ rename: e.target.value })}
            />
          </div>

          <Checkbox
            checked={s.strip}
            onCheckedChange={(strip) => set({ strip })}
            label="Remove location and camera details"
            tip={
              <HelpTip label="About location and camera details">
                Photos can contain hidden details like GPS location, date and camera model.
                Removing them protects your privacy and saves space.
              </HelpTip>
            }
            helper="Smaller file and more private."
          />
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" block>
              <Download aria-hidden="true" />
              {strings.download}
            </Button>
            <Button block>
              <FolderArchive aria-hidden="true" />
              {strings.downloadAllCountZip(3)}
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Help tip at the right edge">
        <div className="flex justify-end text-sm">
          Tip near the edge
          <HelpTip label="About this tip">
            This bubble moves left so it stays on screen, even on a narrow phone.
          </HelpTip>
        </div>
      </Section>
    </div>
  );
}

/** Dev-only review page for the UI kit. */
export default function Showcase() {
  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <h1 className="m-0 text-lg font-semibold">UI kit</h1>
        <span className="flex items-center gap-2 text-ui text-muted">
          Page theme <ThemeToggle announce={false} />
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <Gallery theme="light" />
        <Gallery theme="dark" />
      </div>
      <Toaster />
    </main>
  );
}
