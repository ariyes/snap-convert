// User-facing text for the optimizer and the image pipeline (kept here so it can be translated later).
import type { WebPreset } from '@/core/contracts/image';

export const presetNames: Record<WebPreset['id'], string> = {
  web: 'Web',
  wordpress: 'WordPress',
  shopify: 'Shopify product',
  blog: 'Blog hero',
  email: 'Email',
  thumbnail: 'Thumbnail',
};

export const pipelineStrings = {
  badInput: "Snap Convert couldn't read the settings for this image.",
  unknownOp: (op: string) => `Unknown image operation "${op}".`,
} as const;
