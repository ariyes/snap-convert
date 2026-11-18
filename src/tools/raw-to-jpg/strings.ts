// User-facing text of RAW to JPG (P30). Shared text (Reset, Download, Save to folder …) comes from
// src/ui/strings.ts and the modules.

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const rawToJpgStrings = {
  description:
    'Turn a card’s worth of camera RAW photos into JPGs without Lightroom: fast with the JPG your camera made, or developed from the RAW data for the best quality.',

  // Empty state
  dropTitle: 'Drop RAW photos here',
  dropSubtitle: 'CR2 · CR3 · NEF · ARW · DNG · RAF · ORF · RW2 · PEF · SRW — as many as you like',
  trySample: 'Try a sample RAW',
  sampleName: 'sample-canon-r5.cr3',
  sampleFailed: "The sample couldn't be loaded. Try your own RAW photos instead.",

  // File list
  listLabel: 'RAW photos',
  fileCount: (n: number) => `${n} ${plural(n, 'photo', 'photos')}`,
  add: 'Add',
  addLabel: 'Add more RAW photos',
  clear: 'Clear',
  clearLabel: 'Clear all photos',
  reading: 'Reading…',
  readingLabel: (name: string) => `Reading ${name}`,
  cameraJpegTag: 'camera JPG',
  developTag: 'develops',
  waiting: 'Waiting',
  progressLabel: (name: string) => `Converting ${name}`,
  doneLabel: (size: string) => `Done, ${size}`,
  failed: 'Failed',
  cancelled: 'Cancelled',
  cancelledReason: 'Stopped before it finished.',
  retry: 'Retry',
  retryLabel: (name: string) => `Retry ${name}`,
  removeLabel: (name: string) => `Remove ${name}`,
  download: 'Download',
  downloadLabel: (name: string) => `Download ${name}`,
  dims: 'Size',
  originalSize: 'Original file size',
  newSize: 'New file size',

  // Settings
  panelTitle: 'Settings for all photos',
  qualityModeLabel: 'Quality mode',
  modes: {
    fast: {
      title: 'Fast',
      description: 'Uses the JPG your camera made — instant',
    },
    full: {
      title: 'Full quality',
      description: 'Develops the RAW data — slower, best for editing; recommended on a computer',
    },
  },
  fastNoJpeg: (n: number, total: number) =>
    total === 1
      ? 'This camera didn’t store a full-size JPG, so the RAW data is developed instead (slower).'
      : `${n} of ${total} photos have no full-size camera JPG, so their RAW data is developed instead (slower).`,
  developHeading: 'Develop',
  whiteBalance: 'White balance',
  whiteBalanceModes: { 'as-shot': 'As shot', auto: 'Auto' },
  whiteBalanceHelp: {
    'as-shot': 'The colours your camera chose when you took the photo.',
    auto: 'Neutral greys, worked out from the photo itself.',
  },
  exposure: 'Exposure',
  exposureHelp: 'Brighter or darker, in stops (+1 doubles the light).',
  highlights: 'Highlights',
  highlightModes: { clip: 'Clip', recover: 'Recover' },
  highlightHelp: {
    clip: 'Bright areas go to clean white, like the camera.',
    recover: 'Brings back detail in bright skies and lights.',
  },
  quality: 'Quality',
  qualityModes: { auto: 'Auto', custom: 'Choose' },
  qualityAutoHelp: 'Picks the smallest file that still looks the same as the photo.',
  qualityLevel: 'Quality',
  qualityHelp: 'Lower quality makes smaller files.',
  pngHelp: 'PNG is lossless: exactly the developed pixels, but large files.',

  // Phone advice, shown before a run
  phoneHalfSize: (n: number) =>
    `Large RAW ${plural(n, 'file', 'files')} — this phone can’t develop ${plural(n, 'it', 'them')} at full size, so ${plural(n, 'it comes', 'they come')} out at half size and may be slow. A computer is faster and keeps full size.`,
  phoneSlow: 'Large RAW files — this may be slow on a phone; a computer is faster.',

  // Run and summary
  run: (n: number, format: string) => `Convert ${n} ${plural(n, 'photo', 'photos')} to ${format}`,
  preparing: 'Reading files…',
  working: 'Working…',
  downloadZip: 'Download ZIP',
  changeSettings: 'Change settings',
  cancel: 'Cancel',
  cancelLabel: 'Stop converting',
  processing: (n: number) => `Processing ${n} at a time…`,
  overallProgress: 'Overall progress',
  done: (n: number) => `${n} done`,
  failedCount: (n: number) => `${n} failed`,
  stale: 'Settings changed — convert again to apply them.',
  ready: (n: number) => `${n} ${plural(n, 'photo', 'photos')} ready to convert`,
  runStarted: (n: number) => `Converting ${n} ${plural(n, 'photo', 'photos')}`,
  runFinished: (done: number, failed: number) =>
    failed > 0 ? `Finished: ${done} done, ${failed} failed` : `Finished: ${done} done`,

  // Notes on finished files
  notes: {
    cameraJpeg: 'Used your camera’s JPG',
    developedInstead: 'Developed from the RAW data — the camera’s JPG was too small',
    halfSizePhone: 'Decoded at half size to fit this phone’s memory — use a computer for full size',
    halfSizeDevice:
      'Decoded at half size to fit this device’s memory — a computer with more memory gives full size',
  },

  // Export
  zipName: 'raw-photos',

  // Leaving with results
  leaveTitle: 'Leave this page?',
  leaveUnsaved:
    "Your converted photos haven't been downloaded yet. They are only kept on this page and will be lost if you leave.",
  leaveRunning: 'Photos are still being converted. Leaving stops the work and loses the results.',
  stay: 'Stay',
  leave: 'Leave',
} as const;
