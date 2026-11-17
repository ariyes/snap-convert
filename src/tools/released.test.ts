import { afterEach, describe, expect, it } from 'vitest';
import { countKinds, suggestTools } from '@/app/home/suggest';
import { getTool, isAvailable, ogImageUrl, RELEASED_LATER } from './registry';

// The released set is read-only for app code; tests flip it to check what a release changes.
const released = RELEASED_LATER as Set<string>;

describe('releasing a phase 2 tool (D39)', () => {
  afterEach(() => released.delete('pdf-to-images'));

  it('phase 1 tools are available and unreleased phase 2 tools are not', () => {
    expect(isAvailable(getTool('compress-image')!)).toBe(true);
    expect(isAvailable(getTool('pdf-to-images')!)).toBe(false);
  });

  it('adding the id makes the tool available, with a real preview image and no "soon" chip', () => {
    const tool = getTool('pdf-to-images')!;
    expect(ogImageUrl(tool)).toMatch(/og\/home\.png$/);
    released.add('pdf-to-images');
    expect(isAvailable(tool)).toBe(true);
    expect(ogImageUrl(tool)).toMatch(/og\/images\.png$/);
    const chip = suggestTools(countKinds(['pdf'])).find((s) => s.toolId === 'pdf-to-images');
    if (chip) expect(chip.soon).toBe(false);
  });
});
