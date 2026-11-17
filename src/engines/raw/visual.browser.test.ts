// For looking at results (D24 crispness), not a pass/fail test: with VITE_RAW_VISUAL=1, writes
// PNGs of every RAW fixture into test-results/raw-visual/: the whole picture (1600 px wide) and
// 100 % crops of its most detailed and its smoothest bright area, for the camera JPEG (fast) and
// the full develop.
//   VITE_RAW_VISUAL=1 pnpm vitest run --project browser src/engines/raw/visual.browser.test.ts
import { commands } from 'vitest/browser';
import { describe, it } from 'vitest';
import type { DecodedImage, RawOptions } from '@/core/contracts/image';
import { decodeImageWith } from '@/engines/image/decode';
import { rawFixture } from './testing';

const FILES = (import.meta.env.VITE_RAW_VISUAL_FILES as string | undefined)?.split(',') ?? [
  'canon-1100d.cr2',
  'canon-m50.cr3',
  'nikon-d500.nef',
  'sony-a6400.arw',
  'ricoh-gr.dng',
  'fuji-xs10.raf',
  'olympus-ep5.orf',
  'panasonic-g81.rw2',
  'pentax-k5iis.pef',
  'samsung-nx500.srw',
];
const CROP = 640;

async function png(
  img: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  scaleTo?: number,
): Promise<string> {
  const bitmap = await createImageBitmap(
    img,
    x,
    y,
    w,
    h,
    scaleTo
      ? { resizeWidth: scaleTo, resizeHeight: Math.round((h / w) * scaleTo), resizeQuality: 'high' }
      : {},
  );
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Top-left of the CROP × CROP tile with the most (or least) green-channel detail and enough light. */
function tile(img: ImageData, most: boolean): [number, number] {
  const { width: w, height: h, data } = img;
  let best = most ? -1 : Infinity;
  let at: [number, number] = [0, 0];
  for (let ty = 0; ty + CROP <= h; ty += CROP / 2) {
    for (let tx = 0; tx + CROP <= w; tx += CROP / 2) {
      let e = 0;
      let lum = 0;
      for (let y = ty; y < ty + CROP; y += 4)
        for (let x = tx; x < tx + CROP - 1; x += 4) {
          const i = (y * w + x) * 4;
          e += Math.abs(data[i + 1]! - data[i + 5]!);
          lum += data[i + 1]!;
        }
      lum /= (CROP / 4) ** 2;
      if (!most && lum < 120) continue;
      if (most ? e > best : e < best) {
        best = e;
        at = [tx, ty];
      }
    }
  }
  return at;
}

async function save(
  name: string,
  img: DecodedImage,
  at?: { detail: [number, number]; smooth: [number, number] },
) {
  const p = img.pixels;
  const dir = 'test-results/raw-visual';
  await commands.writeFile(
    `${dir}/${name}-whole.png`,
    await png(p, 0, 0, p.width, p.height, 1600),
    'base64',
  );
  const detail = at?.detail ?? tile(p, true);
  const smooth = at?.smooth ?? tile(p, false);
  await commands.writeFile(
    `${dir}/${name}-detail.png`,
    await png(p, ...detail, CROP, CROP),
    'base64',
  );
  await commands.writeFile(
    `${dir}/${name}-smooth.png`,
    await png(p, ...smooth, CROP, CROP),
    'base64',
  );
  return { detail, smooth };
}

describe.skipIf(!import.meta.env.VITE_RAW_VISUAL)('RAW visual check (writes PNGs)', () => {
  for (const name of FILES) {
    it(
      name,
      async () => {
        const file = await rawFixture(name);
        if (!file) return;
        const extra = (import.meta.env.VITE_RAW_VISUAL_OPTIONS as string | undefined) ?? '';
        const options: Partial<RawOptions> = {
          mode: 'full',
          ...(extra ? (JSON.parse(extra) as object) : {}),
        };
        const full = await decodeImageWith(file, undefined, { raw: options });
        const at = await save(`${name}-full${extra ? '-opt' : ''}`, full);
        const fast = await decodeImageWith(file, undefined, { raw: { mode: 'fast' } });
        if (fast.width === full.width) await save(`${name}-fast`, fast, at);
      },
      120_000,
    );
  }
});
