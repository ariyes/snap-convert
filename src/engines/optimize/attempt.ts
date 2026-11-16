/** One encode of the (already resized) pixels at a quality, scored against those pixels. */
export interface Attempt {
  quality: number;
  /** The finished file (metadata applied), so `bytes` is what the user downloads. */
  blob: Blob;
  bytes: number;
  /** SSIM against the pre-encode pixels (1 = identical). */
  ssim: number;
}

/**
 * Encodes the same prepared pixels at `quality`. The guard and the target search call it
 * several times; the pixels are decoded and resized only once.
 */
export type EncodeAt = (quality: number) => Promise<Attempt>;
