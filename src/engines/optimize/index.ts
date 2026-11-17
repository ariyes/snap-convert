// M5 optimizer (P12): web presets, the quality guard and the target-size search.
// Light code only (no codecs): safe to import from the UI for presets and warnings.
export type { Attempt, EncodeAt } from './attempt';
export {
  GUARD,
  guardMaxSteps,
  guardPlan,
  guardQuality,
  type GuardPlan,
  type GuardResult,
} from './guard';
export {
  getPreset,
  minRecommendedSide,
  PRESET_IDS,
  presetJob,
  WEB_PRESETS,
  type PresetId,
} from './presets';
export { presetNames, pipelineStrings } from './strings';
export {
  cutSample,
  GUARD_SAMPLE,
  guardFromPrediction,
  predictGuardQuality,
  sampleGrid,
  usesGuardSample,
  type GuardPrediction,
  type GuardSampleMode,
  type TileGrid,
} from './sample';
export {
  findQualityForTarget,
  sizeForTarget,
  TARGET_SEARCH,
  type TargetOptions,
  type TargetResult,
} from './target';
