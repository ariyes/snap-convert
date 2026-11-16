// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.
// `declare function` lines from the contract are exported as function types here.

import type { ResizeOptions, ExactOptions, Size } from './sizing';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif';
export type OutputFormat = ImageFormat | 'keep';
export type MetadataPolicy = 'strip-all' | 'keep-all' | 'strip-location';

export interface ImageMetadata {
  orientation: number;            // EXIF 1–8, 1 if none
  hasLocation: boolean;
  camera?: string;
  takenAt?: string;               // ISO date
  exif?: ArrayBuffer;             // original EXIF block, for keep-all / strip-location
  iccProfile?: ArrayBuffer;
}

export interface DecodedImage {
  pixels: ImageData;              // orientation already applied, sRGB
  width: number;
  height: number;
  sourceFormat: ImageFormat | 'heic' | 'gif' | 'bmp' | 'unknown';
  hasAlpha: boolean;
  metadata: ImageMetadata;
  reducedFrom?: Size;             // set when a huge image was decoded at reduced size
}

export interface EncodeOptions {
  format: ImageFormat;
  quality: number;                // 1–100 (ignored for png)
  progressive?: boolean;          // jpeg, default true
  background?: string;            // CSS colour used when alpha goes to jpeg, default '#ffffff'
}

// P05
/** hint.minLongestSide: the pipeline's final output size; huge images may be decoded smaller, but never below it. */
export type DecodeImage = (file: Blob, hint?: { minLongestSide?: number }) => Promise<DecodedImage>;
export type ResizePixels = (img: ImageData, to: Size) => Promise<ImageData>;   // pica, high quality
// P06
export type EncodeImage = (img: ImageData, o: EncodeOptions) => Promise<Blob>;
export type ApplyMetadata = (encoded: Blob, meta: ImageMetadata, policy: MetadataPolicy) => Promise<Blob>;
// P06 — quality tools (image quality standard, decision D24)
export type Ssim = (a: ImageData, b: ImageData) => number;          // 0–1, luma SSIM
export type IsGraphic = (img: ImageData) => boolean;                // text / logo / flat-colour art
export const QUALITY_FLOOR = { minQuality: 60, minSsim: 0.95, defaultSsim: 0.97 } as const;

// P12 — full pipeline, runs inside the image worker
export interface ImageJobInput {
  file: Blob;
  name: string;
  resize?: ResizeOptions;                                      // either resize…
  exact?: ExactOptions & { padColor?: string | 'transparent' }; // …or exact, not both
  format: OutputFormat;
  quality: number;
  targetBytes?: number;                                        // "make it under X"
  metadata: MetadataPolicy;
  width?: number;                 // source size if known (from intake) — lets the queue run 40 MP+ images alone (D27)
  height?: number;
}
export interface ImageJobResult {
  blob: Blob;
  name: string;                   // original base name + new extension (renaming happens in export)
  width: number;
  height: number;
  bytes: number;
  format: ImageFormat;
  quality: number;                // quality actually used
  ssim: number;                   // visual score vs the resized pixels (1 = identical)
  graphic: boolean;               // isGraphic() said text/logo/flat art (UI may suggest PNG)
  notes: Array<'target-unreachable' | 'format-fallback' | 'not-enlarged' | 'padded' | 'cropped' | 'metadata-jpeg-only' | 'reduced-decode'>;
}

export interface WebPreset {
  id: 'web' | 'wordpress' | 'shopify' | 'blog' | 'email' | 'thumbnail';
  name: string;
  longestSide: number;
  format: ImageFormat;
  quality: number;
  metadata: MetadataPolicy;
}
