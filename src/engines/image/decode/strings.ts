// User-facing text for image decoding errors (kept here so it can be translated later).
export const decodeStrings = {
  unsupported: "This file isn't an image Snap Convert can read",
  heicUnsupported: "This HEIC file uses a format your browser can't open",
  tooLarge: (megapixels: number) => `This image is too large (${megapixels} megapixels)`,
} as const;
