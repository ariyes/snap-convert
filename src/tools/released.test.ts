import { afterEach, describe, expect, it } from 'vitest';
import { countKinds, suggestTools } from '@/app/home/suggest';
import { getTool, isAvailable, ogImageUrl, RELEASED_LATER } from './registry';

// The released set is read-only for app code; tests flip it to check what a release changes.
const released = RELEASED_LATER as Set<string>;

describe('releasing a phase 2 tool (D39)', () => {
  afterEach(() => released.delete('remove-background'));

  it('phase 1 tools are available and unreleased phase 2 tools are not', () => {
    expect(isAvailable(getTool('compress-image')!)).toBe(true);
    expect(isAvailable(getTool('remove-background')!)).toBe(false);
  });

  it('released phase 2 tools are available', () => {
    expect(isAvailable(getTool('pdf-to-images')!)).toBe(true);
    expect(isAvailable(getTool('raw-to-jpg')!)).toBe(true);
    // The home page's RAW chip opens the live tool.
    const chip = suggestTools(countKinds(['raw'])).find((s) => s.toolId === 'raw-to-jpg');
    expect(chip?.soon).toBe(false);
  });

  it('adding the id makes the tool available, with a real preview image and no "soon" chip', () => {
    const tool = getTool('remove-background')!;
    expect(ogImageUrl(tool)).toMatch(/og\/home\.png$/);
    released.add('remove-background');
    expect(isAvailable(tool)).toBe(true);
    expect(ogImageUrl(tool)).toMatch(/og\/images\.png$/);
    const chip = suggestTools(countKinds(['image'])).find((s) => s.toolId === 'remove-background');
    if (chip) expect(chip.soon).toBe(false);
  });
});
