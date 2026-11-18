// User-facing text for camera RAW files (kept here so it can be translated later).
export const rawStrings = {
  /** `format` is a camera brand and format, e.g. "Sigma X3F". */
  unsupportedFormat: (format: string) => `This RAW format isn't supported yet (${format})`,
  unsupported: "This RAW format isn't supported yet",
  damaged: 'This file looks damaged',
  tooLarge: 'Too large for this device — try on a computer',
  unavailable: "The RAW decoder couldn't start in this browser — try reloading, or another browser",
} as const;
