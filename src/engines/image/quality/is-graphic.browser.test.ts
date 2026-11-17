// isGraphic on the real reference images (tests/fixtures/quality/), decoded by the browser.
import { describe, expect, it } from 'vitest';
import { decodeImage } from '../decode';
import { fixture } from '../decode/test-utils';
import { graphicStats, isGraphic } from './is-graphic';

describe('isGraphic on the reference images', () => {
  it.each([
    // Wave 1 crispness check: this photo was flagged because of its large clipped-white background.
    ['photo-product-on-white.jpg', false],
    ['photo-night-noise.jpg', false],
    ['sky-gradient.png', false],
    ['text-screenshot.png', true],
    ['line-art-logo.png', true],
  ] as const)('%s → graphic: %s', async (name, graphic) => {
    const img = await decodeImage(await fixture(`quality/${name}`));
    const stats = graphicStats(img.pixels);
    expect(isGraphic(img.pixels), JSON.stringify(stats)).toBe(graphic);
  });
});
