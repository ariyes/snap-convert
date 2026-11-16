// M4 image engine (P12). For use inside the image worker (src/engines/image/worker.ts) — the
// pipeline pulls in the decoders and encoders, so the UI should queue `image` jobs instead of
// importing this. Codecs, pica and libheif are still loaded only on first use.
export {
  chooseFormat,
  decodeHint,
  isPipelineInput,
  outputName,
  padColour,
  placePixels,
  processImage,
  type JobNote,
  type PipelineInput,
  type PipelineResult,
  type ProgressCallback,
} from './pipeline';
export { decodeImage, DecodeError } from './decode';
export { resizePixels } from './resize';
export { encodeImage, ImageEncodeError, CodecUnavailableError } from './encode';
export { applyMetadata, applyMetadataDetailed } from './metadata';
export { isGraphic, ssim } from './quality';
