import type { ExportErrorCode } from './errors';

/**
 * User-facing strings of the export module. Shared button text ("Download",
 * "Download all N as ZIP") comes from `strings` in src/ui/strings.ts.
 */
export const exportStrings = {
  saveToFolder: 'Save to folder',
  /** The ZIP button in the phone action bar, where two buttons share one row. */
  downloadAllShort: 'All (ZIP)',
  saveToFolderHint: 'Pick a folder on your device. Existing files are never replaced.',
  /** File name of the ZIP when the tool doesn't pass one (".zip" is added). */
  defaultZipName: 'snap-convert',
  zipping: (percent: number) => `Creating ZIP… ${percent}%`,
  saving: (percent: number) => `Saving to folder… ${percent}%`,
  zipReady: 'ZIP ready. Your download should start now.',
  saved: (count: number) =>
    count === 1 ? 'Saved 1 file to the folder.' : `Saved ${count} files to the folder.`,
  progressLabel: 'Export progress',
  errors: {
    'zip-too-large':
      'These files add up to more than 4 GB, which is too big for one ZIP. Download them in smaller groups or use Save to folder.',
    'zip-too-many-files':
      'A ZIP can hold up to 65,535 files. Download them in smaller groups or use Save to folder.',
    'zip-failed': 'The ZIP could not be created. Please try again.',
    'save-failed':
      'The files could not be saved to that folder. Check that you allowed access and there is enough space, then try again.',
  } satisfies Record<ExportErrorCode, string>,
} as const;
