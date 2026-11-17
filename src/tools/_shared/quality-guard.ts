// One quality-guard rule for every image tool (D28/D29): the guard may raise quality to keep a
// photo crisp on default and preset runs, and is off once the user has moved the quality slider —
// their own quality is then used as it is. Tracked with an explicit flag in the tool's remembered
// settings, never inferred from "quality equals the default".

export interface QualityFlag {
  /** The user moved the quality slider (cleared by Reset and by presets). */
  qualitySet: boolean;
}

export const QUALITY_FLAG_DEFAULT: Readonly<QualityFlag> = { qualitySet: false };

/** A settings patch with the flag set when it changes the quality (a manual change). */
export function withQualityFlag<P extends object>(patch: P): P & Partial<QualityFlag> {
  return 'quality' in patch ? { ...patch, qualitySet: true } : patch;
}

/** Whether a run with these settings uses the quality guard. */
export function qualityGuardFor(settings: QualityFlag): boolean {
  return !settings.qualitySet;
}
