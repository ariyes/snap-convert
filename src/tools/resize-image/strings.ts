// User-facing text of Resize image (P15). Shared control text lives in the image-settings module.
import type { Anchor } from '@/core/contracts/sizing';

export const resizeStrings = {
  panelTitle: 'Settings for all files',
  anchorTitle: 'Keep this part',
  anchorTipLabel: 'About the crop position',
  anchorTip:
    'Fill trims the edges that don’t fit the box. Choose which part of the image to keep; the rest is cut off, never squashed.',
  anchorGroup: 'Part of the image to keep',
  anchors: {
    'top-left': 'Top left',
    top: 'Top',
    'top-right': 'Top right',
    left: 'Left',
    center: 'Centre',
    right: 'Right',
    'bottom-left': 'Bottom left',
    bottom: 'Bottom',
    'bottom-right': 'Bottom right',
  } satisfies Record<Anchor, string>,
} as const;
