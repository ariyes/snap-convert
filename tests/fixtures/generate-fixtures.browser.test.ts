// Writes the generated fixtures in tests/fixtures/images/ and tests/fixtures/quality/.
// Skipped in normal test runs. To regenerate (output is committed):
//   VITE_WRITE_FIXTURES=1 pnpm vitest run --project browser tests/fixtures/generate-fixtures.browser.test.ts
// Real photos (HEIC, the four photos in quality/) are downloaded, not generated: see README.md.

import encodeAvif from '@jsquash/avif/encode.js';
import { describe, it } from 'vitest';
import { commands } from 'vitest/browser';
import { orientPixels } from '@/engines/image/decode/orientation';
import { QUADRANT_COLOURS, TAG, jpegWithExif, writeBmp, writeExif, writeGif, type ExifSpec } from './writers';

const enabled = import.meta.env.VITE_WRITE_FIXTURES === '1';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function save(path: string, bytes: Uint8Array): Promise<void> {
  await commands.writeFile(path, toBase64(bytes), 'base64');
}

async function encode(img: ImageData, type: string, quality?: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no context');
  ctx.putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type, quality });
  if (blob.type !== type) throw new Error(`browser can't encode ${type}`);
  return new Uint8Array(await blob.arrayBuffer());
}

function draw(width: number, height: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void): ImageData {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no context');
  paint(ctx);
  return ctx.getImageData(0, 0, width, height);
}

function quadrants(width: number, height: number): ImageData {
  return draw(width, height, (ctx) => {
    const fill = (c: readonly number[], x: number, y: number) => {
      ctx.fillStyle = `rgb(${c.join(',')})`;
      ctx.fillRect(x, y, width / 2, height / 2);
    };
    fill(QUADRANT_COLOURS.topLeft, 0, 0);
    fill(QUADRANT_COLOURS.topRight, width / 2, 0);
    fill(QUADRANT_COLOURS.bottomLeft, 0, height / 2);
    fill(QUADRANT_COLOURS.bottomRight, width / 2, height / 2);
  });
}

/** Stored pixels that come out upright once `orientation` is applied (6 and 8 are each other's inverse). */
function storedFor(upright: ImageData, orientation: number): ImageData {
  const inverse = orientation === 6 ? 8 : orientation === 8 ? 6 : orientation;
  return orientPixels(upright, inverse);
}

const camera: ExifSpec['ifd0'] = {
  [TAG.Make]: { type: 'ascii', value: 'Snap Convert' },
  [TAG.Model]: { type: 'ascii', value: 'Fixture Camera' },
  [TAG.DateTime]: { type: 'ascii', value: '2024:05:06 07:08:09' },
};

async function writeImages(): Promise<void> {
  const upright = quadrants(96, 64);
  for (let o = 1; o <= 8; o++) {
    const jpeg = await encode(storedFor(upright, o), 'image/jpeg', 0.95);
    const exif = writeExif({
      ifd0: { ...camera, [TAG.Orientation]: { type: 'short', value: o } },
      exif: {
        [TAG.DateTimeOriginal]: { type: 'ascii', value: '2024:05:06 07:08:09' },
        [TAG.OffsetTimeOriginal]: { type: 'ascii', value: '+02:00' },
      },
    });
    await save(`tests/fixtures/images/orientation-${o}.jpg`, jpegWithExif(jpeg, exif));
  }

  const gpsExif = writeExif({
    ifd0: { ...camera, [TAG.Orientation]: { type: 'short', value: 1 } },
    gps: {
      [TAG.GPSLatitudeRef]: { type: 'ascii', value: 'N' },
      [TAG.GPSLatitude]: { type: 'rational', value: [[51, 1], [30, 1], [0, 1]] },
      [TAG.GPSLongitudeRef]: { type: 'ascii', value: 'W' },
      [TAG.GPSLongitude]: { type: 'rational', value: [[0, 1], [7, 1], [0, 1]] },
    },
  });
  await save('tests/fixtures/images/gps.jpg', jpegWithExif(await encode(upright, 'image/jpeg', 0.95), gpsExif));
  await save('tests/fixtures/images/no-exif.jpg', await encode(upright, 'image/jpeg', 0.95));

  // PNG with alpha: transparent left third, half-transparent middle, opaque right.
  const alpha = draw(90, 60, (ctx) => {
    ctx.fillStyle = 'rgba(0, 128, 255, 0.5)';
    ctx.fillRect(30, 0, 30, 60);
    ctx.fillStyle = 'rgb(255, 64, 0)';
    ctx.fillRect(60, 0, 30, 60);
  });
  await save('tests/fixtures/images/alpha.png', await encode(alpha, 'image/png'));
  await save('tests/fixtures/images/opaque.png', await encode(quadrants(90, 60), 'image/png'));
  await save('tests/fixtures/images/sample.webp', await encode(quadrants(80, 60), 'image/webp', 0.9));

  const avif = await encodeAvif(quadrants(80, 60), { quality: 80 });
  await save('tests/fixtures/images/sample.avif', new Uint8Array(avif));

  await save('tests/fixtures/images/sample.bmp', writeBmp(quadrants(50, 30)));

  // Two-frame GIF: first frame is the quadrant card (palette 0–3), second is all white.
  const palette: Array<[number, number, number]> = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 255, 255],
  ];
  const gw = 40;
  const gh = 30;
  const first = new Uint8Array(gw * gh).map((_, i) => {
    const x = i % gw;
    const y = Math.floor(i / gw);
    return (y < gh / 2 ? 0 : 2) + (x < gw / 2 ? 0 : 1);
  });
  await save('tests/fixtures/images/sample.gif', writeGif(gw, gh, palette, [first, new Uint8Array(gw * gh).fill(4)]));
}

// ---------- Reference quality set (synthetic members) ----------

function skyGradient(): ImageData {
  // Vertical deep blue → pale horizon with a soft sun glow: smooth everywhere, steps ≤ 1 level.
  const w = 2400;
  const h = 1600;
  const img = new ImageData(w, h);
  const top = [38, 92, 168];
  const bottom = [206, 226, 240];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / (h - 1);
      const dx = (x - w * 0.7) / w;
      const dy = (y - h * 0.85) / h;
      const glow = Math.exp(-(dx * dx + dy * dy) * 6) * 30;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = (top[c] ?? 0) + ((bottom[c] ?? 0) - (top[c] ?? 0)) * t + glow * (c === 2 ? 0.2 : 1);
        img.data[i + c] = Math.round(Math.min(255, v));
      }
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function textScreenshot(): ImageData {
  return draw(1600, 1000, (ctx) => {
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, 1600, 1000);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, 1600, 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.fillText('Snap Convert — Settings', 24, 42);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(40, 100, 1520, 860);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.strokeRect(40.5, 100.5, 1519, 859);
    const sizes = [32, 24, 18, 15, 13, 11];
    let y = 160;
    for (const size of sizes) {
      ctx.fillStyle = '#111827';
      ctx.font = `${size}px Arial, sans-serif`;
      ctx.fillText(`${size}px: The quick brown fox jumps over the lazy dog 0123456789 ÄÖÜ €@&%`, 70, y);
      y += size * 2.4;
    }
    ctx.fillStyle = '#2563eb';
    ctx.font = '16px Georgia, serif';
    ctx.fillText('Serif link text: https://example.com/a/long/path?with=query&and=more', 70, y + 10);
    ctx.fillStyle = '#b91c1c';
    ctx.font = 'bold 14px Consolas, monospace';
    ctx.fillText('error: const value = image.width * scale; // monospace code', 70, y + 50);
    // Table rows with 1 px rules
    for (let r = 0; r < 8; r++) {
      const ry = 640 + r * 36;
      ctx.fillStyle = r % 2 ? '#f9fafb' : '#ffffff';
      ctx.fillRect(70, ry, 1460, 36);
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(70, ry + 35, 1460, 1);
      ctx.fillStyle = '#374151';
      ctx.font = '14px Arial, sans-serif';
      ctx.fillText(`Row ${r + 1}`, 86, ry + 23);
      ctx.fillText(`photo-${1000 + r}.jpg`, 300, ry + 23);
      ctx.fillText(`${(1.2 + r * 0.37).toFixed(2)} MB`, 800, ry + 23);
      ctx.fillStyle = '#16a34a';
      ctx.fillText('Done', 1300, ry + 23);
    }
  });
}

function lineArt(): ImageData {
  const size = 2000;
  const img = draw(size, size, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    // Logo: thick ring, star and word mark.
    ctx.lineWidth = 40;
    ctx.strokeStyle = '#e11d48';
    ctx.beginPath();
    ctx.arc(500, 500, 330, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#1e3a8a';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 110 : 260;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(500 + r * Math.cos(a), 500 + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 150px Arial, sans-serif';
    ctx.fillStyle = '#111111';
    ctx.fillText('SNAP', 1000, 450);
    ctx.fillStyle = '#0f766e';
    ctx.fillText('CONVERT', 1000, 620);
    // Thin lines at angles (1–4 px) — jaggies and blur show here.
    ctx.strokeStyle = '#000000';
    for (let i = 0; i < 24; i++) {
      ctx.lineWidth = 1 + (i % 4);
      const a = (i / 24) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(500, 1450);
      ctx.lineTo(500 + 420 * Math.cos(a), 1450 - 420 * Math.sin(a));
      ctx.stroke();
    }
    // Mid-grey panel with a lighter square: halos are visible on mid-tones (not clipped at 0/255).
    ctx.fillStyle = 'rgb(96, 96, 96)';
    ctx.fillRect(1000, 760, 900, 300);
    ctx.fillStyle = 'rgb(176, 176, 176)';
    ctx.fillRect(1150, 830, 300, 160);
    ctx.fillRect(1600, 760, 300, 300);
  });
  // Fine-line gratings (period 2 px and 3 px) and a zone plate: moiré shows up here.
  const put = (x: number, y: number, v: number) => {
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  };
  for (let y = 1100; y < 1300; y++) {
    for (let x = 1000; x < 1400; x++) put(x, y, x % 2 ? 0 : 255);
    for (let x = 1500; x < 1900; x++) put(x, y, (x % 3) === 0 ? 0 : 255);
  }
  const cx = 1450;
  const cy = 1650;
  const R = 300;
  const k = Math.PI / (2 * R); // local frequency reaches 0.5 cycles/px at r = R
  for (let y = cy - R; y < cy + R; y++) {
    for (let x = cx - R; x < cx + R; x++) {
      const r2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (r2 <= R * R) put(x, y, Math.round(127.5 + 127.5 * Math.cos(k * r2)));
    }
  }
  return img;
}

async function writeQualitySet(): Promise<void> {
  await save('tests/fixtures/quality/sky-gradient.png', await encode(skyGradient(), 'image/png'));
  await save('tests/fixtures/quality/text-screenshot.png', await encode(textScreenshot(), 'image/png'));
  await save('tests/fixtures/quality/line-art-logo.png', await encode(lineArt(), 'image/png'));
}

describe.runIf(enabled)('generate fixtures', () => {
  it('writes tests/fixtures/images', writeImages, 60_000);
  it('writes the synthetic part of tests/fixtures/quality', writeQualitySet, 120_000);
});
