import { describe, expect, it } from 'vitest';
import type { IntakeFile } from '@/core/contracts/intake';
import { WEB_PRESETS } from '@/engines/optimize';
import { parseSettings } from '@/features/settings';
import { OPTIMIZE_DEFAULTS, optimizeJobInput, optimizeSchema, settingsKey } from './settings';

const file: IntakeFile = {
  id: 'f1',
  file: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
  name: 'photo.jpg',
  size: 1,
  kind: 'image',
  width: 4032,
  height: 3024,
};

describe('optimizeJobInput', () => {
  it.each(WEB_PRESETS.map((p) => [p.id, p] as const))(
    '%s uses the preset size, quality and metadata, guarded and never enlarged',
    (id, preset) => {
      const input = optimizeJobInput(file, { destination: id, format: 'jpeg' });
      expect(input.resize).toEqual({ mode: 'longest', value: preset.longestSide, upscale: false });
      expect(input.exact).toBeUndefined();
      expect(input.format).toBe('jpeg');
      expect(input.quality).toBe(preset.quality);
      expect(input.metadata).toBe('strip-all');
      expect(input.qualityGuard).toBe(true);
      expect(input.targetBytes).toBeUndefined();
      expect(input.file).toBe(file.file);
      expect(input.name).toBe('photo.jpg');
      // Passed on so the queue runs huge images alone (D27).
      expect([input.width, input.height]).toEqual([4032, 3024]);
    },
  );

  it('uses the chosen format', () => {
    expect(optimizeJobInput(file, { destination: 'web', format: 'webp' }).format).toBe('webp');
    expect(optimizeJobInput(file, { destination: 'web', format: 'avif' }).format).toBe('avif');
  });
});

describe('settings', () => {
  it('defaults to Website (general) as JPG', () => {
    expect(OPTIMIZE_DEFAULTS).toEqual({ destination: 'web', format: 'jpeg' });
  });

  it('ignores stored values that are not offered', () => {
    const raw = JSON.stringify({ destination: 'instagram', format: 'png' });
    expect(parseSettings(raw, OPTIMIZE_DEFAULTS, optimizeSchema)).toEqual(OPTIMIZE_DEFAULTS);
    const ok = JSON.stringify({ destination: 'email', format: 'avif' });
    expect(parseSettings(ok, OPTIMIZE_DEFAULTS, optimizeSchema)).toEqual({
      destination: 'email',
      format: 'avif',
    });
  });

  it('keys runs by destination and format', () => {
    expect(settingsKey({ destination: 'web', format: 'jpeg' })).not.toBe(
      settingsKey({ destination: 'web', format: 'webp' }),
    );
  });
});
