import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageJobResult } from '@/core/contracts/image';
import type { IntakeFile } from '@/core/contracts/intake';
import { DestinationPicker } from './destination-picker';
import { FileRow, type FileRowProps } from './file-row';
import { FormatPicker } from './format-picker';
import { optimizeStrings as t } from './strings';
import type { OptimizeJob } from './use-optimize-run';

afterEach(cleanup);
const inRouter = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('DestinationPicker', () => {
  it('shows six cards with size and format, Website (general) selected', async () => {
    const onChange = vi.fn();
    render(<DestinationPicker value="web" format="jpeg" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: t.destinationLabel });
    const cards = within(group).getAllByRole('radio');
    expect(cards.map((c) => c.getAttribute('aria-labelledby') && c.textContent)).toEqual([
      'Website (general)1920 px · JPG',
      'WordPress2048 px · JPG',
      'Shopify2048 px · JPG',
      'Blog hero1600 px · JPG',
      'Email800 px · JPG',
      'Thumbnail400 px · JPG',
    ]);
    expect(
      screen.getByRole('radio', { name: 'Website (general)' }).getAttribute('aria-checked'),
    ).toBe('true');
    await userEvent.click(screen.getByRole('radio', { name: 'Blog hero' }));
    expect(onChange).toHaveBeenCalledWith('blog');
  });

  it('shows the chosen format on the cards', () => {
    render(<DestinationPicker value="web" format="webp" onChange={() => {}} />);
    expect(screen.getByText('1920 px · WebP')).toBeTruthy();
  });
});

describe('FormatPicker', () => {
  it('offers JPG and WebP, with AVIF under Advanced', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FormatPicker value="jpeg" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: t.formatLabel });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['JPG', 'WebP']);
    expect(screen.getByText(t.formatHelp.jpeg)).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: 'WebP' }));
    expect(onChange).toHaveBeenLastCalledWith('webp');

    expect(screen.queryByRole('checkbox', { name: t.useAvif })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: t.advanced }));
    await userEvent.click(screen.getByRole('checkbox', { name: t.useAvif }));
    expect(onChange).toHaveBeenLastCalledWith('avif');

    rerender(<FormatPicker value="avif" onChange={onChange} />);
    expect(screen.getByText(t.formatHelp.avif)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: t.useAvif }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

const file: IntakeFile = {
  id: 'f1',
  file: new File(['x'], 'IMG_1.jpg'),
  name: 'IMG_1.jpg',
  size: 1_000_000,
  kind: 'image',
  width: 4032,
  height: 3024,
};

function doneJob(patch: Partial<ImageJobResult> = {}): OptimizeJob {
  return {
    id: 'j1',
    kind: 'image',
    op: 'process',
    label: 'IMG_1.jpg',
    input: {},
    status: 'done',
    progress: 1,
    result: {
      blob: new Blob(['x']),
      name: 'IMG_1.jpg',
      width: 1920,
      height: 1440,
      bytes: 160_000,
      format: 'jpeg',
      quality: 80,
      ssim: 0.98,
      graphic: false,
      notes: [],
      ...patch,
    },
  };
}

function row(props: Partial<FileRowProps>) {
  return inRouter(
    <ul>
      <FileRow
        file={file}
        job={undefined}
        destination="web"
        canRemove
        onRemove={() => {}}
        onRetry={() => {}}
        onDownload={() => {}}
        onUseJpeg={() => {}}
        {...props}
      />
    </ul>,
  );
}

describe('FileRow', () => {
  it('shows the planned size while waiting', () => {
    row({});
    expect(screen.getByTestId('file-dims').textContent).toBe('4032×3024 → 1920×1440');
    expect(screen.getByText(t.waiting)).toBeTruthy();
    expect(screen.queryByTestId('small-warning')).toBeNull();
  });

  it('shows before → after size and the checklist when done', () => {
    row({ job: doneJob(), outName: 'IMG_1-web.jpg' });
    expect(screen.getByText('IMG_1-web.jpg')).toBeTruthy();
    expect(screen.getByTestId('file-bytes').textContent).toBe('977 KB → 156 KB');
    const list = screen.getByRole('list', { name: t.checklistLabel });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Resized to 1920 px', 'Location removed', '84% smaller', 'Looks the same']);
    expect(screen.getByRole('button', { name: 'Download IMG_1-web.jpg' })).toBeTruthy();
  });

  it('leaves out "Looks the same" for a guard-short result', () => {
    row({ job: doneJob({ notes: ['guard-short'] }) });
    expect(screen.queryByText(t.looksSame)).toBeNull();
    expect(screen.getByText(t.guardShort)).toBeTruthy();
  });

  it('warns when the image is small for the destination', () => {
    row({ file: { ...file, width: 900, height: 600 }, destination: 'blog' });
    expect(screen.getByTestId('small-warning').textContent).toBe(
      'This image is 900 px wide — it may look soft as a full-width banner',
    );
  });

  it('offers JPG when WebP came out larger', async () => {
    const onUseJpeg = vi.fn();
    row({
      job: doneJob({ format: 'webp', name: 'IMG_1.webp', bytes: 2_000_000 }),
      onUseJpeg,
    });
    await userEvent.click(screen.getByRole('button', { name: t.tryJpg }));
    expect(onUseJpeg).toHaveBeenCalled();
  });

  it('shows the error and a retry button when it failed', async () => {
    const onRetry = vi.fn();
    row({
      job: { ...doneJob(), status: 'failed', result: undefined, error: 'Broken file' },
      onRetry,
    });
    expect(screen.getByRole('alert').textContent).toBe('Broken file');
    await userEvent.click(screen.getByRole('button', { name: t.retryFile('IMG_1.jpg') }));
    expect(onRetry).toHaveBeenCalled();
  });
});
