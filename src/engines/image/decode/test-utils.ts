// Helpers for the image engine's browser tests (not used by app code).
import { commands } from 'vitest/browser';

/** Reads a file under tests/fixtures/ as a Blob (through Vitest's file commands, not the network). */
export async function fixture(path: string): Promise<Blob> {
  const base64 = await commands.readFile(`tests/fixtures/${path}`, 'base64');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

export type Rgba = [number, number, number, number];

export function pixelAt(img: ImageData, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, d[i + 3] ?? 0];
}

/** Largest per-channel difference between two colours (RGB only). */
export function colourDistance(a: readonly number[], b: readonly number[]): number {
  return Math.max(
    Math.abs((a[0] ?? 0) - (b[0] ?? 0)),
    Math.abs((a[1] ?? 0) - (b[1] ?? 0)),
    Math.abs((a[2] ?? 0) - (b[2] ?? 0)),
  );
}

/** The four corner colours, sampled a few pixels in (away from JPEG edge effects). */
export function corners(
  img: ImageData,
  inset = 6,
): Record<'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight', Rgba> {
  const r = img.width - 1 - inset;
  const b = img.height - 1 - inset;
  return {
    topLeft: pixelAt(img, inset, inset),
    topRight: pixelAt(img, r, inset),
    bottomLeft: pixelAt(img, inset, b),
    bottomRight: pixelAt(img, r, b),
  };
}

/** Encodes pixels with the browser (for building large test inputs at runtime). */
export async function encodeWithCanvas(
  img: ImageData,
  type: string,
  quality?: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.putImageData(img, 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer());
}
