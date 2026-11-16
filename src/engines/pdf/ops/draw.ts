import {
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { Matrix } from './transforms';

/** Progress callback, 0–1. */
export type Progress = (p: number) => void;

/**
 * Draws an image or embedded page with one full matrix. pdf-lib's `drawImage`/`drawPage` can
 * rotate but not mirror, and EXIF orientations 2, 4, 5 and 7 need mirroring.
 */
export function drawXObject(page: PDFPage, tag: 'Image' | 'Page', ref: PDFRef, m: Matrix): void {
  const name = page.node.newXObject(tag, ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...m),
    drawObject(name),
    popGraphicsState(),
  );
}
