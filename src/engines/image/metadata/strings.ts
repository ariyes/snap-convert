// Readable messages for broken JPEG / EXIF data. Shown on the failed file if they reach the UI.
export const metadataStrings = {
  notJpeg: 'This file is not a JPEG (it has no JPEG start marker).',
  truncated: 'This JPEG file is cut short: it ends before the image data.',
  badMarker: (offset: number) => `This JPEG file is damaged: no marker where one was expected (byte ${offset}).`,
  badLength: (offset: number) => `This JPEG file is damaged: a header section has an impossible length (byte ${offset}).`,
  doubleStart: 'This JPEG file is damaged: it starts twice.',
  noFrame: 'This JPEG file is damaged: it has no image size information.',
  badFrame: 'This JPEG file is damaged: its image size information is unreadable.',
  segmentTooLong: 'A JPEG header section is too large to write (over 64 KB).',
  badExif: (detail: string) => `The photo details (EXIF) are damaged: ${detail}.`,
};
