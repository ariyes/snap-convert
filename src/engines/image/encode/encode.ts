import type { EncodeImage, EncodeOptions, ImageFormat } from '@/core/contracts/image';
import { isGraphic } from '../quality/is-graphic';
import type { Pixels } from '../quality/pixels';
import { flattenOnto, parseBackground } from './background';
import { canUseThreads, loadCodec } from './codecs';
import { ImageEncodeError } from './errors';
import {
  avifOptions,
  chooseChroma,
  clampQuality,
  jpegOptions,
  MAX_SIDE,
  pngOptions,
  webpOptions,
} from './options';
import { encodeStrings } from './strings';

export const MIME_TYPES: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

export interface EncodeHints {
  /**
   * The result of `isGraphic()` on these pixels, if the caller already has it (the pipeline
   * scores it anyway, and the target-size search encodes the same pixels several times).
   */
  graphic?: boolean;
}

/**
 * Encodes RGBA pixels to JPEG, PNG, WebP or AVIF following the image quality standard (D24).
 * Runs inside a Web Worker; codecs load on first use. Output carries no EXIF, XMP or comments —
 * use `applyMetadata` afterwards to add any back.
 *
 * Throws `CodecUnavailableError` if the codec can't load (the pipeline falls back to another
 * format), or `ImageEncodeError` for other failures. Error messages are user-readable.
 */
export async function encodeImage(
  img: ImageData,
  o: EncodeOptions,
  hints: EncodeHints = {},
): Promise<Blob> {
  const { format } = o;
  const { width, height } = img;
  if (!(width > 0 && height > 0) || img.data.length !== width * height * 4) {
    throw new ImageEncodeError('bad-input', format, encodeStrings.badSize);
  }
  const max = MAX_SIDE[format];
  if (width > max || height > max) {
    throw new ImageEncodeError('too-large', format, encodeStrings.tooLarge(format, max));
  }

  const quality = clampQuality(o.quality);
  let bytes: ArrayBuffer;
  try {
    switch (format) {
      case 'jpeg': {
        const encode = await loadCodec('jpeg');
        // JPEG has no alpha: put transparent pixels on the background colour first.
        const flat = flattenOnto(img, parseBackground(o.background));
        const graphic = hints.graphic ?? (quality >= 90 ? true : isGraphic(flat));
        const chroma = chooseChroma(quality, graphic);
        bytes = await encode(
          toImageData(flat),
          jpegOptions(quality, chroma, o.progressive ?? true),
        );
        break;
      }
      case 'png': {
        const encode = await loadCodec('png');
        bytes = await encode(img, pngOptions);
        break;
      }
      case 'webp': {
        const encode = await loadCodec('webp');
        bytes = await encode(img, webpOptions(quality));
        break;
      }
      case 'avif': {
        const encode = await loadCodec('avif');
        const graphic = hints.graphic ?? (quality >= 90 ? true : isGraphic(img));
        const chroma = chooseChroma(quality, graphic);
        bytes = await encode(img, avifOptions(quality, chroma, width * height, canUseThreads()));
        break;
      }
    }
  } catch (cause) {
    if (cause instanceof ImageEncodeError) throw cause;
    throw new ImageEncodeError('encode-failed', format, encodeStrings.encodeFailed(format), {
      cause,
    });
  }
  return new Blob([bytes], { type: MIME_TYPES[format] });
}

const _contract: EncodeImage = encodeImage;
void _contract;

function toImageData(p: Pixels): ImageData {
  if (p instanceof ImageData) return p;
  return new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);
}
