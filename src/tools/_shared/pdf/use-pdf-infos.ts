import { useEffect, useState } from 'react';
import type { PdfInfo } from '@/core/contracts/pdf';
import { readPdfInfo } from '@/engines/pdf';

export type PdfInfoState =
  | { status: 'loading' }
  | { status: 'ready'; info: PdfInfo }
  /** Not a readable PDF (damaged, or not a PDF at all). */
  | { status: 'error' };

export const INFO_LOADING: PdfInfoState = { status: 'loading' };

// One read per file for as long as the file is around (pages, encryption, page sizes).
const cache = new WeakMap<Blob, Promise<PdfInfoState>>();

function infoState(file: Blob): Promise<PdfInfoState> {
  let promise = cache.get(file);
  if (!promise) {
    promise = readPdfInfo(file).then(
      (info): PdfInfoState => ({ status: 'ready', info }),
      (): PdfInfoState => ({ status: 'error' }),
    );
    cache.set(file, promise);
  }
  return promise;
}

/**
 * Page count, encryption and page sizes of each file (P08's readPdfInfo). Look a file up with
 * `infos.get(file) ?? INFO_LOADING`. "Password-protected" is decided here, up front: the PDF
 * worker's error codes don't cross the worker boundary.
 */
export function usePdfInfos(files: ReadonlyArray<{ file: Blob }>): ReadonlyMap<Blob, PdfInfoState> {
  const [states, setStates] = useState<ReadonlyMap<Blob, PdfInfoState>>(() => new Map());

  useEffect(() => {
    let alive = true;
    for (const { file } of files) {
      void infoState(file).then((state) => {
        if (!alive) return;
        setStates((prev) => (prev.get(file) === state ? prev : new Map(prev).set(file, state)));
      });
    }
    return () => {
      alive = false;
    };
  }, [files]);

  return states;
}
