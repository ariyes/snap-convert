// isGraphic on the real reference images (tests/fixtures/quality/), decoded by the browser.
import { describe, expect, it } from 'vitest';
import { decodeImage } from '../decode';
import { fixture } from '../decode/test-utils';
import { flattenOnto } from '../encode/background';
import { graphicStats, isGraphic } from './is-graphic';

describe('isGraphic on the reference images', () => {
  it.each([
    // Wave 1 crispness check: this photo was flagged because of its large clipped-white background.
    ['photo-product-on-white.jpg', false],
    ['photo-night-noise.jpg', false],
    ['sky-gradient.png', false],
    ['text-screenshot.png', true],
    ['line-art-logo.png', true],
    // P24b F1: flat colours with a drop shadow, a glow and a soft text shadow.
    ['logo-soft-shadow.png', true],
    ['photo-fine-detail.jpg', false],
    ['photo-portrait-exif-rotated.jpg', false],
  ] as const)('%s → graphic: %s', async (name, graphic) => {
    const img = await decodeImage(await fixture(`quality/${name}`));
    const stats = graphicStats(img.pixels);
    expect(isGraphic(img.pixels), JSON.stringify(stats)).toBe(graphic);
  });

  it('the soft-shadow logo is a graphic on white as well (as when converted to JPEG)', async () => {
    const img = await decodeImage(await fixture('quality/logo-soft-shadow.png'));
    const onWhite = flattenOnto(img.pixels, [255, 255, 255]);
    expect(isGraphic(onWhite), JSON.stringify(graphicStats(onWhite))).toBe(true);
  });
});
