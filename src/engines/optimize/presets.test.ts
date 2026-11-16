import { describe, expect, it } from 'vitest';
import { getPreset, minRecommendedSide, PRESET_IDS, presetJob, WEB_PRESETS } from './presets';

describe('web presets (docs/03-features.md)', () => {
  it('match the web defaults table', () => {
    const sides = Object.fromEntries(WEB_PRESETS.map((p) => [p.id, p.longestSide]));
    expect(sides).toEqual({
      web: 1920,
      wordpress: 2048,
      shopify: 2048,
      blog: 1600,
      email: 800,
      thumbnail: 400,
    });
    for (const p of WEB_PRESETS) {
      expect(p).toMatchObject({ format: 'jpeg', quality: 80, metadata: 'strip-all' });
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('build a never-enlarging, guarded job', () => {
    const file = new Blob([]);
    expect(presetJob('blog', file, 'a.png')).toEqual({
      file,
      name: 'a.png',
      resize: { mode: 'longest', value: 1600, upscale: false },
      format: 'jpeg',
      quality: 80,
      metadata: 'strip-all',
      qualityGuard: true,
    });
  });

  it('recommend a minimum size below each preset size', () => {
    for (const id of PRESET_IDS) {
      const min = minRecommendedSide(id);
      expect(min).toBeGreaterThan(0);
      expect(min).toBeLessThanOrEqual(getPreset(id).longestSide);
    }
    expect(minRecommendedSide('web')).toBe(1200); // full-width image (docs example)
  });

  it('reject an unknown preset', () => {
    expect(() => getPreset('nope' as never)).toThrow(RangeError);
  });
});
