import { useEffect, useRef } from 'react';

/**
 * Draws an ImageBitmap into a canvas of the bitmap's own size (CSS decides how big it shows, e.g.
 * `object-contain` to letterbox it — never stretched). The bitmap stays owned by whoever made it
 * (P08's usePageThumbnail closes it later).
 */
export function BitmapCanvas({ bitmap, className }: { bitmap: ImageBitmap; className?: string }) {
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
