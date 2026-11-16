// User-facing text for encoder errors (shown on the failed file).
import type { ImageFormat } from '@/core/contracts/image';

export const formatNames: Record<ImageFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
};

export const encodeStrings = {
  codecUnavailable: (format: ImageFormat) =>
    `Your browser couldn't load the ${formatNames[format]} encoder.`,
  tooLarge: (format: ImageFormat, max: number) =>
    `This image is too big to save as ${formatNames[format]} (largest side ${max.toLocaleString('en')} px).`,
  encodeFailed: (format: ImageFormat) => `Couldn't save this image as ${formatNames[format]}.`,
  badSize: 'This image has no pixels to save.',
};
