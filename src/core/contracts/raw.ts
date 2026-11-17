// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.
// `declare function` lines from the contract are exported as function types here.

import type { DecodedImage, RawOptions } from './image';

/** The largest JPEG the camera stored inside the RAW file. */
export interface RawPreview { jpeg: Blob; width: number; height: number }

export interface RawInfo {
  camera?: string;                // "Canon EOS R5"
  width: number;                  // developed image size, before orientation
  height: number;
  orientation: number;            // EXIF 1–8
  previews: Array<{ width: number; height: number }>; // embedded JPEGs, largest first
}

// P29 (M7, inside the image worker)
export type ReadRawInfo = (file: Blob) => Promise<RawInfo>;
/** Largest embedded JPEG, or null if the file has none. */
export type ExtractRawPreview = (file: Blob) => Promise<RawPreview | null>;
/** Develops the RAW data to sRGB 8-bit pixels, orientation applied. `halfSize` halves both sides (one scale). */
export type DecodeRaw = (file: Blob, o: Omit<RawOptions, 'mode'> & { halfSize: boolean }) => Promise<DecodedImage>;
