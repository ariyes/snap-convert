import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { exactPlacement, type Size } from '@/core/sizing';
import { usePageThumbnail } from '@/engines/pdf';
import type { Rotation } from './pages';

/** Thumbnails are rendered this many CSS px on the long side (sharp at the device pixel ratio). */
export const THUMB_SIZE = 160;

/** The page area of a tile, in layout units (prototype `.page-thumb`: 1 / 1.3). */
const BOX: Size = { width: 1000, height: 1300 };

/** Points to whole hundredths, the unit `exactPlacement` measures in here. */
const units = (size: Size): Size => ({
  width: Math.max(1, Math.round(size.width * 100)),
  height: Math.max(1, Math.round(size.height * 100)),
});

/**
 * Where a page (size as displayed, in points) sits in the tile once turned by `rotate`: fitted
 * and centred by `exactPlacement`, never stretched. Returns the size of the page *before* the CSS
 * rotation, as percentages of the box, so the turned page fills the fitted area exactly.
 */
export function thumbStyle(page: Size, rotate: Rotation): CSSProperties {
  const sideways = rotate === 90 || rotate === 270;
  const shown = sideways ? { width: page.height, height: page.width } : page;
  const { target } = exactPlacement(units(shown), { ...BOX, fit: 'fit', upscale: true });
  const width = sideways ? target.height : target.width;
  const height = sideways ? target.width : target.height;
  return {
    width: `${(width / BOX.width) * 100}%`,
    height: `${(height / BOX.height) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
  };
}

/** True while the element is on screen (or near it), so only visible thumbnails render. */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  // Without IntersectionObserver every thumbnail renders.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, inView] as const;
}

/** Draws an ImageBitmap the hook owns into a canvas (the hook closes the bitmap later). */
function BitmapCanvas({ bitmap, className }: { bitmap: ImageBitmap; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={ref} aria-hidden="true" className={className} />;
}

export interface PageThumbProps {
  file: Blob;
  /** 0-based page index in `file`. */
  index: number;
  /** The page's size as displayed (from readPdfInfo). */
  size: Size;
  rotate: Rotation;
}

/** One page, turned by `rotate`, fitted in a 1 : 1.3 area. Renders only near the screen. Paper uses
 * the `handle` token: white in both themes. */
export function PageThumb({ file, index, size, rotate }: PageThumbProps) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const { bitmap } = usePageThumbnail(file, index, THUMB_SIZE, inView);
  return (
    <div ref={ref} className="relative aspect-[1/1.3] w-full overflow-hidden rounded-md bg-sunk">
      <div
        data-testid="page-paper"
        className="absolute top-1/2 left-1/2 border border-line bg-handle transition-transform duration-150 motion-reduce:transition-none"
        style={thumbStyle(size, rotate)}
      >
        {bitmap && <BitmapCanvas bitmap={bitmap} className="block size-full" />}
      </div>
    </div>
  );
}
