import { describe, expect, it } from 'vitest';

// Proves the browser test project runs in a real browser with the APIs the engines need.
describe('browser test environment', () => {
  it('has real ImageData and OffscreenCanvas', async () => {
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    ctx?.putImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1), 0, 0);
    expect(Array.from(ctx?.getImageData(0, 0, 1, 1).data ?? [])).toEqual([255, 0, 0, 255]);

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    expect([bitmap.width, bitmap.height]).toEqual([2, 2]);
    bitmap.close();
  });

  it('can run WebAssembly and module workers', () => {
    expect(typeof WebAssembly.instantiate).toBe('function');
    expect(typeof Worker).toBe('function');
  });
});
