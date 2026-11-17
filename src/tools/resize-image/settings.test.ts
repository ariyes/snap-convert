import { describe, expect, it } from 'vitest';
import { withQualityFlag } from '@/tools/_shared';
import { planSize } from '@/features/image-settings';
import { parseSettings } from '@/features/settings';
import {
  RESIZE_DEFAULTS,
  RESIZE_MODES,
  resizeJobOptions,
  resizeSettingsSchema,
  type ResizeToolSettings,
} from './settings';

const settings = (patch: Partial<ResizeToolSettings> = {}): ResizeToolSettings => ({
  ...RESIZE_DEFAULTS,
  ...patch,
});

describe('Resize defaults', () => {
  it('match the task: same format, quality 85, no enlarging, size in the name', () => {
    expect(RESIZE_DEFAULTS).toMatchObject({
      format: 'keep',
      quality: 85,
      upscale: false,
      resizeMode: 'longest',
      resizeSize: 1920,
      rename: '{name}-{width}x{height}',
      anchor: 'center',
    });
    expect(RESIZE_MODES).toEqual(['longest', 'width', 'height', 'percent', 'exact']);
  });

  it('plans the sizes from the sizing rule', () => {
    const longest1000 = settings({ resizeSize: 1000 });
    expect(planSize({ width: 2000, height: 1500 }, longest1000)?.output).toEqual({
      width: 1000,
      height: 750,
    });
    expect(planSize({ width: 1500, height: 2000 }, longest1000)?.output).toEqual({
      width: 750,
      height: 1000,
    });
    const small = planSize({ width: 800, height: 600 }, settings());
    expect(small).toMatchObject({ output: { width: 800, height: 600 }, notEnlarged: true });
  });
});

describe('resizeJobOptions', () => {
  it('resizes by the chosen mode, guarded at the default quality', () => {
    expect(resizeJobOptions(settings({ resizeSize: 1000 }))).toEqual({
      resize: { mode: 'longest', value: 1000, upscale: false },
      format: 'keep',
      quality: 85,
      targetBytes: undefined,
      metadata: 'strip-all',
      exact: undefined,
      qualityGuard: true,
    });
  });

  it('turns the quality guard off once the user moves the quality slider (D28/D29)', () => {
    expect(resizeJobOptions(RESIZE_DEFAULTS).qualityGuard).toBe(true);
    const moved = settings(withQualityFlag({ quality: 70 }));
    expect(resizeJobOptions(moved).qualityGuard).toBe(false);
    // Back at 85 by hand: still the user's choice, not inferred from "equals the default".
    const back = { ...moved, ...withQualityFlag({ quality: RESIZE_DEFAULTS.quality }) };
    expect(resizeJobOptions(back).qualityGuard).toBe(false);
    expect(resizeJobOptions(settings(withQualityFlag({ resizeSize: 800 }))).qualityGuard).toBe(
      true,
    );
  });

  it('never sends a target size, even if one is stored', () => {
    expect(
      resizeJobOptions(settings({ qualityMode: 'target', targetKb: 50 })).targetBytes,
    ).toBeUndefined();
  });

  it('passes the crop anchor for Fill and centres Fit', () => {
    const exact = { resizeMode: 'exact' as const, exactWidth: 1080, exactHeight: 1080 };
    expect(resizeJobOptions(settings({ ...exact, fit: 'fill', anchor: 'top' })).exact).toEqual({
      width: 1080,
      height: 1080,
      fit: 'fill',
      upscale: false,
      padColor: '#ffffff',
      anchor: 'top',
    });
    const fit = resizeJobOptions(
      settings({ ...exact, fit: 'fit', anchor: 'top', padColor: '#000000' }),
    );
    expect(fit.exact).toMatchObject({ fit: 'fit', anchor: 'center', padColor: '#000000' });
    expect(fit.resize).toBeUndefined();
  });
});

describe('stored Resize settings', () => {
  it('fall back to the defaults when invalid', () => {
    const stored = JSON.stringify({ anchor: 'middle', resizeMode: 'none', quality: 90 });
    const parsed = parseSettings(stored, RESIZE_DEFAULTS, resizeSettingsSchema);
    expect(parsed).toMatchObject({ anchor: 'center', resizeMode: 'longest', quality: 90 });
  });
});
