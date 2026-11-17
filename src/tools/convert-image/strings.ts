// User-facing text of Convert image and the format pages (P15).
export const convertStrings = {
  panelTitle: 'Settings for all files',
  background: 'Background for transparent areas',
  backgroundTipLabel: 'About the background colour',
  backgroundTip:
    'JPG can’t store transparency, so see-through parts of PNG, WebP or AVIF images are filled with this colour.',
  backgroundNames: { white: 'White', black: 'Black', lightGrey: 'Light grey' },
  customColour: 'Custom colour',
  keepsTransparency: 'PNG, WebP and AVIF keep transparent areas.',
} as const;
