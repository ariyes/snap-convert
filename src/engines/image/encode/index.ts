// M4 encoders (P06): JPEG (mozjpeg), PNG (oxipng), WebP and AVIF, all loaded on demand.
export { encodeImage, MIME_TYPES, type EncodeHints } from './encode';
export {
  CodecUnavailableError,
  ImageEncodeError,
  isCodecUnavailable,
  type EncodeErrorCode,
} from './errors';
export { chooseChroma, clampQuality, DEFAULT_QUALITY, type Chroma } from './options';
export { parseBackground } from './background';
