import { fitSize, type Size } from '@/core/sizing';
import { usePageThumbnail } from '@/engines/pdf';
import { Helper } from '@/ui';
import { BitmapCanvas } from '@/tools/_shared';
import { formatSide, previewLayout, type ResizeSettings } from './settings';
import { resizeStrings as t } from './strings';

/** The preview area (CSS px). The new page is fitted inside it. */
export const PREVIEW_BOX: Size = { width: 280, height: 210 };
/** Small first-page thumbnails in the file list (CSS px, long side). */
export const ROW_THUMB = 40;

export interface PagePreviewProps {
  file: Blob;
  fileName: string;
  /** First page size as displayed, in points. */
  content: Size;
  settings: ResizeSettings;
}

/**
 * The first page on its new paper: the new page fitted in the preview box, and the old page's
 * content scaled uniformly and centred on it, both placed with `exactPlacement` (never stretched).
 * The paper uses the `handle` token: white in both themes.
 */
export function PagePreview({ file, fileName, content, settings }: PagePreviewProps) {
  const layout = previewLayout(content, settings, PREVIEW_BOX);
  const { page, content: box, pageSize } = layout;
  // One render, sharp at the largest size the content can take in the box.
  const { bitmap } = usePageThumbnail(file, 0, PREVIEW_BOX.width);
  const sizeName = t.sizeNames[settings.size];
  const orientation = pageSize.width > pageSize.height ? 'landscape' : 'portrait';

  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={t.previewLabel(fileName, sizeName)}
        data-testid="resize-preview"
        className="relative mx-auto overflow-hidden rounded-control bg-sunk"
        style={{ width: PREVIEW_BOX.width, height: PREVIEW_BOX.height }}
      >
        <div
          data-testid="preview-page"
          className="absolute bg-handle shadow-raised outline outline-line"
          style={{ left: page.x, top: page.y, width: page.width, height: page.height }}
        >
          <div
            data-testid="preview-content"
            className="absolute overflow-hidden outline-1 outline-accent outline-dashed"
            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          >
            {bitmap && <BitmapCanvas bitmap={bitmap} className="block size-full" />}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 text-center">
        <span className="text-ui font-medium">
          {t.previewSize(
            sizeName,
            formatSide(pageSize.width, settings.unit),
            formatSide(pageSize.height, settings.unit),
            settings.unit,
            orientation,
          )}
        </span>
        <Helper>{t.previewScale(Math.round(layout.scale * 100))}</Helper>
      </div>
    </div>
  );
}

/** A small first-page thumbnail for the file list (page shape from `fitSize`). */
export function RowThumb({ file, size }: { file: Blob; size: Size | undefined }) {
  const { bitmap } = usePageThumbnail(file, 0, ROW_THUMB, size !== undefined);
  const shape = size ? fitSize(size, { mode: 'longest', value: ROW_THUMB, upscale: true }) : null;
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-sunk">
      {shape && (
        <span
          className="block border border-line bg-handle"
          style={{ width: shape.width, height: shape.height }}
        >
          {bitmap && <BitmapCanvas bitmap={bitmap} className="block size-full" />}
        </span>
      )}
    </span>
  );
}
