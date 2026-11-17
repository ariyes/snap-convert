/**
 * The home page's big drop box: P11's DropZone, taking every kind of file.
 *
 * Loaded as its own chunk so the file-reading code (format sniffers, header parsers, folder walk)
 * stays out of the home page's startup JS (150 KiB budget). The chunk is requested as soon as this
 * module runs, alongside hydration rather than after it. The pre-rendered HTML still has the full
 * drop box (entry.server waits for lazy parts); after a client-side visit, a box of the same size
 * holds its place for the moment the chunk takes.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import type { IntakeFile } from '@/core/contracts/intake';
import { appStrings } from '../strings';
import { ALL_KINDS } from './suggest';

const dropZoneModule = import('@/features/intake').then(({ DropZone }) => ({ default: DropZone }));
const DropZone = lazy(() => dropZoneModule);

/** Rendered next to the DropZone: its effect runs once the drop box is live (hydrated). */
function Live({ onLive }: { onLive: (live: true) => void }) {
  useEffect(() => onLive(true), [onLive]);
  return null;
}

export function HomeDropZone({ onFiles }: { onFiles: (files: IntakeFile[]) => void }) {
  const [live, setLive] = useState(false);

  return (
    // data-live: the drop box takes clicks, drops and pastes (end-to-end tests wait for it).
    <div data-testid="home-drop" data-live={live || undefined}>
      <Suspense
        fallback={
          <div
            aria-hidden="true"
            className="mt-7 h-[278px] rounded-2xl border-[1.5px] border-dashed border-line bg-card"
          />
        }
      >
        <DropZone
          accept={ALL_KINDS}
          multiple
          pasteHint
          title={appStrings.dropTitle}
          subtitle={appStrings.dropFormats}
          onFiles={onFiles}
          className="mt-7"
        />
        <Live onLive={setLive} />
      </Suspense>
    </div>
  );
}
