import { FileWarning } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePageThumbnail } from '@/engines/pdf';
import { cn } from '@/lib/utils';
import { useInView } from './use-in-view';

export interface PdfPageThumbProps {
  file: Blob;
  /** 0-based page. */
  pageIndex: number;
  /** Long side in CSS px (the bitmap is sharper on high-density screens). */
  maxSize: number;
  className?: string;
}

/**
 * One rendered PDF page (P08's usePageThumbnail), filling its box without stretching. It only
 * renders while on screen, and a render still running is cancelled when it scrolls away or the
 * page is left. `data-state` is loading | ready | error.
 */
export function PdfPageThumb({ file, pageIndex, maxSize, className }: PdfPageThumbProps) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const { bitmap, error } = usePageThumbnail(file, pageIndex, maxSize, inView);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  }, [bitmap]);

  const state = bitmap ? 'ready' : error ? 'error' : 'loading';
  return (
    <div
      ref={ref}
      data-state={state}
      aria-hidden="true"
      className={cn('relative grid size-full place-items-center', className)}
    >
      {bitmap ? (
        <canvas
          ref={canvasRef}
          width={bitmap.width}
          height={bitmap.height}
          // object-contain letterboxes the page inside the box: never stretched.
          className="size-full object-contain"
        />
      ) : error ? (
        <FileWarning className="size-6 text-faint" />
      ) : (
        <span className="size-full animate-pulse bg-sunk" />
      )}
    </div>
  );
}
