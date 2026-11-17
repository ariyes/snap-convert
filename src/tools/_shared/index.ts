// Shared pieces of the tool pages: the single-image screen (P15: Resize, Convert, HEIC to JPG,
// format pages), the quality-guard rule, and small helpers every tool uses (P20b). The PDF pages'
// own pieces are in ./pdf.
export { BitmapCanvas } from './bitmap-canvas';
export { formatBytes, formatTimeLeft, sizeChange, type SizeChange } from './format';
export { useInView } from './use-in-view';
export { LONG_PRESS_MS, usePointerReorder, type ReorderDrag } from './use-pointer-reorder';
export { planJobs, type JobEntry, type JobPlan } from './job-plan';
export { JobCancelled, runQueued, type QueuedJob, type QueueLike } from './queue-job';
export { baseName, EXTENSIONS, outputFileName, outputFileNames, type NamedResult } from './names';
export { resultNotes, type ResultNote, type ResultNoteSource } from './notes';
export {
  QUALITY_FLAG_DEFAULT,
  qualityGuardFor,
  withQualityFlag,
  type QualityFlag,
} from './quality-guard';
export {
  SingleImageTool,
  type SingleImageContext,
  type SingleImageToolProps,
} from './SingleImageTool';
export { formatLabels, singleImageStrings } from './strings';
export {
  isImageJobResult,
  SETTINGS_DEBOUNCE_MS,
  useImageJobs,
  type FileJob,
  type ImageJobOptions,
} from './use-image-jobs';
