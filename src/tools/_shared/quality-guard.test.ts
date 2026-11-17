import { describe, expect, it } from 'vitest';
import { QUALITY_FLAG_DEFAULT, qualityGuardFor, withQualityFlag } from './quality-guard';

describe('quality guard rule (D28/D29)', () => {
  it('is on for default and preset runs', () => {
    expect(qualityGuardFor(QUALITY_FLAG_DEFAULT)).toBe(true);
  });

  it('is off once a patch moved the quality, whatever the value', () => {
    expect(withQualityFlag({ quality: 80 })).toEqual({ quality: 80, qualitySet: true });
    expect(qualityGuardFor({ ...QUALITY_FLAG_DEFAULT, ...withQualityFlag({ quality: 80 }) })).toBe(
      false,
    );
  });

  it('leaves other changes alone', () => {
    const patch = { format: 'webp' };
    expect(withQualityFlag(patch)).toBe(patch);
  });
});
