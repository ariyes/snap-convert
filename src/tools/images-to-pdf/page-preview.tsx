import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { Rect, Size } from '@/core/sizing';
import { cn } from '@/lib/utils';
import { previewLayout, PREVIEW_BOX, type PageOptions } from './page-layout';
import { strings } from './strings';

export interface PagePreviewProps {
  /** Upright image size in pixels, if known (from the file header). */
  size?: Size;
  /** Image URL the browser can show (undefined while a HEIC preview is being made). */
  src?: string;
  name: string;
  options: PageOptions;
  busy?: boolean;
  className?: string;
}

const box = (r: Rect) => ({
  left: `${r.x}%`,
  top: `${r.y}%`,
  width: `${r.width}%`,
  height: `${r.height}%`,
});

/**
 * The live page preview: the page, its margins and the image placed on it exactly as the PDF will
 * have it. Every rectangle comes from `exactPlacement` (see page-layout.ts).
 */
export function PagePreview({ size, src, name, options, busy, className }: PagePreviewProps) {
  // Without a header size, the image's own size once it has loaded.
  const [natural, setNatural] = useState<Size | undefined>(undefined);
  const source = size ?? natural ?? { width: 1, height: 1 };
  const layout = previewLayout(source, options);
  const margin = options.marginMm > 0;

  return (
    <div
      role="img"
      aria-label={strings.previewLabel(name, strings.pageLabel(options.pageSize, layout.landscape))}
      data-testid="page-preview"
      data-page-width={layout.page.width.toFixed(2)}
      data-page-height={layout.page.height.toFixed(2)}
      className={cn('relative w-full overflow-hidden rounded-md bg-sunk', className)}
      style={{ aspectRatio: `${PREVIEW_BOX.width} / ${PREVIEW_BOX.height}` }}
    >
      {/* Paper is white in both themes, like the prototype's page thumbnails. */}
      <span
        aria-hidden="true"
        className="absolute bg-handle shadow-raised ring-1 ring-line"
        style={box(layout.pageRect)}
      />
      {margin && (
        <span
          aria-hidden="true"
          data-testid="page-margin"
          className="absolute border border-dashed border-faint/50"
          style={box(layout.contentRect)}
        />
      )}
      <span aria-hidden="true" className="absolute" style={box(layout.imageRect)}>
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            loading="lazy"
            onLoad={(e) => {
              if (size) return;
              const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
              if (width > 0 && height > 0) setNatural({ width, height });
            }}
            className="block size-full object-contain"
          />
        ) : (
          <span className="grid size-full place-items-center opacity-80 bg-accent-shape">
            {busy && <LoaderCircle className="size-5 animate-spin text-on-accent" />}
          </span>
        )}
      </span>
    </div>
  );
}
