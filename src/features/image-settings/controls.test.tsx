import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebPreset } from '@/core/contracts/image';
import { DimsPreview } from './dims-preview';
import { FormatSelect } from './format-select';
import { MetadataSelect } from './metadata-select';
import { PresetChips } from './preset-chips';
import { QualityOrTarget, QualitySlider } from './quality-or-target';
import { RenamePattern } from './rename-pattern';
import { ResizeFields } from './resize-fields';
import { imageSettingsStrings as strings } from './strings';
import {
  applyPreset,
  clearPresetOnChange,
  IMAGE_SETTINGS_DEFAULTS,
  type ImageSettingsValues,
} from './values';

afterEach(cleanup);

type Values = ImageSettingsValues;
type Patch = Partial<Values>;

/** Holds settings like a tool does and shows them as JSON for assertions. */
function Harness({
  initial = {},
  children,
}: {
  initial?: Patch;
  children: (v: Values, update: (p: Patch) => void) => ReactNode;
}) {
  const [values, setValues] = useState<Values>({ ...IMAGE_SETTINGS_DEFAULTS, ...initial });
  const update = (patch: Patch) => setValues((prev) => ({ ...prev, ...patch }));
  return (
    <>
      {children(values, update)}
      <pre data-testid="values">{JSON.stringify(values)}</pre>
    </>
  );
}
const values = (): Values => JSON.parse(screen.getByTestId('values').textContent ?? '{}') as Values;

/** Every help tip is a real button with a name and a description screen readers can read. */
function expectReadableTip(name: string, text: string) {
  const tip = screen.getByRole('button', { name });
  const descId = tip.getAttribute('aria-describedby') ?? '';
  expect(document.getElementById(descId)?.textContent).toBe(text);
}

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
    id: 'email',
    name: 'Email',
    longestSide: 800,
    format: 'jpeg',
    quality: 80,
    metadata: 'strip-all',
  },
];

describe('PresetChips', () => {
  it('applies a preset, shows it pressed, and a manual change clears it', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {(v, update) => (
          <>
            <PresetChips
              presets={PRESETS}
              value={v.preset}
              onSelect={(p) => update(applyPreset(p))}
              announce={false}
            />
            <QualitySlider value={v} onChange={clearPresetOnChange<Values>(update)} />
          </>
        )}
      </Harness>,
    );
    const group = screen.getByRole('group', { name: strings.presetsTitle });
    const email = within(group).getByRole('button', { name: 'Email' });
    expect(email.getAttribute('aria-pressed')).toBe('false');

    await user.click(email);
    expect(email.getAttribute('aria-pressed')).toBe('true');
    expect(values()).toMatchObject({ preset: 'email', resizeSize: 800, format: 'jpeg' });

    // Each chip says what it sets.
    const descId = email.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(descId)?.textContent).toBe(
      'Longest side 800 px, JPG, quality 80',
    );

    // Keyboard change of the quality slider is a manual change.
    screen.getByRole('slider').focus();
    await user.keyboard('{ArrowLeft}');
    expect(values()).toMatchObject({ preset: null, quality: 79 });
    expect(email.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('QualityOrTarget', () => {
  it('switches between quality and target size, with readable tips', async () => {
    const user = userEvent.setup();
    render(<Harness>{(v, update) => <QualityOrTarget value={v} onChange={update} />}</Harness>);
    const slider = screen.getByRole('slider', { name: strings.quality });
    expect(slider.getAttribute('aria-valuemin')).toBe('10');
    expect(slider.getAttribute('aria-valuemax')).toBe('100');
    expect(slider.getAttribute('aria-valuenow')).toBe('80');
    expectReadableTip(strings.qualityTipLabel, strings.qualityTip);

    await user.click(screen.getByRole('radio', { name: strings.targetFileSize }));
    expect(values().qualityMode).toBe('target');
    const field = screen.getByRole('spinbutton', { name: strings.targetLabel });
    expect((field as HTMLInputElement).value).toBe('200');
    await user.clear(field);
    await user.type(field, '150');
    expect(values().targetKb).toBe(150);
    expectReadableTip(strings.targetTipLabel, strings.targetTip);
  });
});

describe('FormatSelect', () => {
  it('is labelled "Save as" and shows the current format', () => {
    render(<Harness>{(v, update) => <FormatSelect value={v} onChange={update} />}</Harness>);
    const trigger = screen.getByRole('combobox', { name: strings.saveAs });
    expect(trigger.textContent).toContain('Same as original');
  });

  it('suggests PNG for graphics, with a one-tap switch', async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ format: 'jpeg' }}>
        {(v, update) => <FormatSelect value={v} onChange={update} graphic />}
      </Harness>,
    );
    expect(screen.getByText(strings.graphicHint)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: strings.usePng }));
    expect(values().format).toBe('png');
    expect(screen.queryByText(strings.graphicHint)).toBeNull();
  });

  it('can use the short "Same" label', () => {
    render(
      <Harness>{(v, update) => <FormatSelect value={v} onChange={update} compact />}</Harness>,
    );
    expect(screen.getByRole('combobox', { name: strings.saveAs }).textContent).toContain('Same');
  });
});

describe('ResizeFields', () => {
  it('optional: "Also resize" shows the mode and size, and the preview', async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ resizeEnabled: false }}>
        {(v, update) => (
          <ResizeFields
            optional
            value={v}
            onChange={update}
            modes={['longest', 'width', 'height', 'percent']}
            preview={<span>preview</span>}
          />
        )}
      </Harness>,
    );
    expect(screen.queryByRole('combobox', { name: strings.resizeBy })).toBeNull();
    expect(screen.getByText('preview')).toBeTruthy();
    expectReadableTip(strings.alsoResizeTipLabel, strings.alsoResizeTip);

    await user.click(screen.getByRole('checkbox', { name: strings.alsoResize }));
    expect(values().resizeEnabled).toBe(true);
    expect(screen.getByRole('combobox', { name: strings.resizeBy }).textContent).toContain(
      'Longest side',
    );
    const size = screen.getByRole('spinbutton', { name: strings.size });
    await user.clear(size);
    await user.type(size, '1200');
    expect(values().resizeSize).toBe(1200);
  });

  it('percent mode uses its own value and the % unit', () => {
    render(
      <Harness initial={{ resizeMode: 'percent' }}>
        {(v, update) => <ResizeFields value={v} onChange={update} />}
      </Harness>,
    );
    const size = screen.getByRole<HTMLInputElement>('spinbutton', { name: strings.size });
    expect(size.value).toBe('50');
    expect(size.max).toBe('100');
    expect(screen.getByText('%')).toBeTruthy();
  });

  it('labelled "Resize by" with a tip and the proportions note', () => {
    render(<Harness>{(v, update) => <ResizeFields value={v} onChange={update} />}</Harness>);
    expect(screen.getByRole('combobox', { name: strings.resizeBy })).toBeTruthy();
    expectReadableTip(strings.resizeByTipLabel, strings.resizeByTip);
    expect(screen.getByText(strings.lockedNote)).toBeTruthy();
  });

  it('exact size: W × H, Fit / Fill cards and padding colour', async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ resizeMode: 'exact' }}>
        {(v, update) => <ResizeFields value={v} onChange={update} />}
      </Harness>,
    );
    expect(screen.getByRole('spinbutton', { name: strings.width })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: strings.height })).toBeTruthy();
    expectReadableTip(strings.fitTipLabel, strings.fitTip);
    expect(screen.getByText(strings.neverStretched)).toBeTruthy();

    const padding = screen.getByRole('radiogroup', { name: strings.padColour });
    await user.click(within(padding).getByRole('radio', { name: 'Black' }));
    expect(values().padColor).toBe('#000000');

    const fit = screen.getByRole('radiogroup', { name: strings.fitGroup });
    await user.click(within(fit).getByRole('radio', { name: strings.fill }));
    expect(values().fit).toBe('fill');
    // Fill has no empty space, so no padding colour.
    expect(screen.queryByRole('radiogroup', { name: strings.padColour })).toBeNull();
  });

  it('upscale is off by default and warns when turned on', async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ resizeMode: 'percent', resizePercent: 100 }}>
        {(v, update) => <ResizeFields value={v} onChange={update} />}
      </Harness>,
    );
    const upscale = screen.getByRole('checkbox', { name: strings.upscale });
    expect(upscale.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(strings.upscaleNote)).toBeNull();

    await user.click(upscale);
    expect(values().upscale).toBe(true);
    expect(screen.getByText(strings.upscaleNote)).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: strings.size }).max).toBe(
      '400',
    );
  });

  it("Don't resize shows no size fields", () => {
    render(
      <Harness initial={{ resizeMode: 'none' }}>
        {(v, update) => <ResizeFields value={v} onChange={update} />}
      </Harness>,
    );
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: strings.upscale })).toBeNull();
  });
});

describe('DimsPreview', () => {
  const photo = { width: 4032, height: 3024 };

  it('shows the describe() text and "Proportions locked"', () => {
    render(<DimsPreview source={photo} values={IMAGE_SETTINGS_DEFAULTS} />);
    const box = screen.getByTestId('dims-preview');
    expect(box.textContent).toContain('4032×3024');
    expect(box.textContent).toContain('1920×1440');
    expect(box.textContent).toContain(strings.proportionsLocked);
  });

  it('says "not enlarged" for a smaller image', () => {
    render(<DimsPreview source={{ width: 800, height: 600 }} values={IMAGE_SETTINGS_DEFAULTS} />);
    expect(screen.getByTestId('dims-preview').textContent).toContain(strings.notEnlarged);
  });

  it('says "padded" or "cropped" for exact sizes', () => {
    const exact = { ...IMAGE_SETTINGS_DEFAULTS, resizeMode: 'exact' as const };
    const { rerender } = render(<DimsPreview source={photo} values={exact} />);
    expect(screen.getByTestId('dims-preview').textContent).toContain(strings.padded);
    rerender(<DimsPreview source={photo} values={{ ...exact, fit: 'fill' }} />);
    expect(screen.getByTestId('dims-preview').textContent).toContain(strings.cropped);
  });

  it('warns when the result is small for the chosen use', () => {
    const email = { ...IMAGE_SETTINGS_DEFAULTS, resizeSize: 800 };
    const { rerender } = render(
      <DimsPreview source={photo} values={email} minRecommendedSide={1200} />,
    );
    expect(screen.getByText(strings.smallForUse(1200))).toBeTruthy();
    rerender(
      <DimsPreview source={photo} values={IMAGE_SETTINGS_DEFAULTS} minRecommendedSide={1200} />,
    );
    expect(screen.queryByText(strings.smallForUse(1200))).toBeNull();
  });

  it('shows nothing without a valid source size', () => {
    const { container, rerender } = render(
      <DimsPreview source={null} values={IMAGE_SETTINGS_DEFAULTS} />,
    );
    expect(container.textContent).toBe('');
    rerender(<DimsPreview source={{ width: 0, height: 0 }} values={IMAGE_SETTINGS_DEFAULTS} />);
    expect(container.textContent).toBe('');
  });
});

describe('MetadataSelect', () => {
  it('removes details by default; unchecking keeps everything', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {(v, update) => <MetadataSelect value={v} onChange={update} format={v.format} />}
      </Harness>,
    );
    const box = screen.getByRole('checkbox', { name: strings.removeDetails });
    expect(box.getAttribute('aria-checked')).toBe('true');
    expectReadableTip(strings.metadataTipLabel, strings.metadataTip);
    await user.click(box);
    expect(values().metadata).toBe('keep-all');
  });

  it('offers "Remove location only" and "Keep everything" under More options', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {(v, update) => <MetadataSelect value={v} onChange={update} format="jpeg" />}
      </Harness>,
    );
    await user.click(screen.getByText(strings.moreOptions));
    const group = screen.getByRole('radiogroup', { name: strings.metadataPolicyGroup });
    await user.click(within(group).getByRole('radio', { name: 'Remove location only' }));
    expect(values().metadata).toBe('strip-location');
    expect(
      screen.getByRole('checkbox', { name: strings.removeDetails }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('notes that details can only be kept in JPG files', () => {
    const { rerender } = render(
      <MetadataSelect value={{ metadata: 'keep-all' }} onChange={vi.fn()} format="png" />,
    );
    expect(screen.getByText(strings.jpegOnly)).toBeTruthy();
    rerender(<MetadataSelect value={{ metadata: 'keep-all' }} onChange={vi.fn()} format="jpeg" />);
    expect(screen.queryByText(strings.jpegOnly)).toBeNull();
    rerender(<MetadataSelect value={{ metadata: 'strip-all' }} onChange={vi.fn()} format="png" />);
    expect(screen.queryByText(strings.jpegOnly)).toBeNull();
    rerender(
      <MetadataSelect
        value={{ metadata: 'keep-all' }}
        onChange={vi.fn()}
        format="keep"
        jpegOnlyNote
      />,
    );
    expect(screen.getByText(strings.jpegOnly)).toBeTruthy();
  });
});

describe('RenamePattern', () => {
  it('shows a live example and token help', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {(v, update) => (
          <RenamePattern
            value={v}
            onChange={update}
            example={{ name: 'IMG_2041', width: 1920, height: 1440, n: 1, format: 'jpg' }}
          />
        )}
      </Harness>,
    );
    const input = screen.getByRole('textbox', { name: strings.fileNames });
    const helper = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(helper?.textContent).toContain('IMG_2041-1920w.jpg');
    expect(helper?.textContent).toContain('{format}');
    expectReadableTip(strings.fileNamesTipLabel, strings.fileNamesTip);

    await user.clear(input);
    await user.type(input, '{{n}_{{height}'); // "{{" types one "{"
    expect(values().rename).toBe('{n}_{height}');
    expect(helper?.textContent).toContain('1_1440.jpg');
  });
});
