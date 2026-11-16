/** Shared user-facing text. Tool-specific text lives in each tool's own strings.ts. */
export const strings = {
  // Buttons
  reset: 'Reset',
  resetTitle: 'Put every setting back to its default',
  resetDone: 'Settings reset to defaults',
  download: 'Download',
  downloadAllZip: 'Download all as ZIP',
  downloadAllCountZip: (n: number) => `Download all ${n} as ZIP`,
  chooseFiles: 'Choose files',
  addFiles: 'Add files',
  remove: 'Remove',
  cancel: 'Cancel',
  retry: 'Try again',

  // Help tip
  helpTipLabel: 'More info',

  // Theme
  themeName: { system: 'follow device', light: 'light', dark: 'dark' },
  themeButtonLabel: (name: string) => `Theme: ${name}. Click to change`,
  themeChanged: (name: string) => `Theme: ${name}`,

  // Compare slider
  compareLabel: 'Compare original and compressed',
  compareBefore: 'Original',
  compareAfter: 'Compressed',
  /** Read out by screen readers as the slider's value. */
  compareValueText: (beforePercent: number) => `${beforePercent}% original`,

  // Progress
  progress: 'Progress',

  // Select
  selectPlaceholder: 'Choose…',

  // Brand
  appName: 'Snap Convert',
  byline: 'by crkayes',

  // Paste hint (drop zones)
  pasteHintPrefix: 'or paste with',
  transparent: 'Transparent',
} as const;
