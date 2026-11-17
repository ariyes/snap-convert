// Makes the "Try with 12 sample files" images in a worker (OffscreenCanvas), so the page ships no
// large assets and the main thread stays free. Shapes, sizes and names follow the prototype:
// landscape, portrait, square, panorama, tiny, a graphic, and one broken download.

import {
  SAMPLE_SPECS,
  type SampleFile,
  type SampleResponse,
  type SampleSpec,
} from './sample-specs';

function drawPhoto(ctx: OffscreenCanvasRenderingContext2D, spec: SampleSpec): void {
  const { width: w, height: h, hue } = spec;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, `hsl(${hue} 70% 72%)`);
  sky.addColorStop(0.6, `hsl(${(hue + 30) % 360} 60% 55%)`);
  sky.addColorStop(1, `hsl(${(hue + 60) % 360} 45% 28%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const unit = Math.min(w, h);
  // A sun and some hills, so the photo has edges and soft areas.
  ctx.fillStyle = `hsl(${(hue + 180) % 360} 90% 80% / 0.85)`;
  ctx.beginPath();
  ctx.arc(w * 0.72, h * 0.3, unit * 0.12, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `hsl(${(hue + 90 + i * 12) % 360} 35% ${38 - i * 6}%)`;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += Math.max(8, w / 64)) {
      const y = h * (0.62 + i * 0.09) + Math.sin(x / (w / (3 + i)) + i) * unit * 0.05;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgb(255 255 255 / 0.9)';
  ctx.font = `600 ${Math.round(unit * 0.07)}px sans-serif`;
  ctx.fillText(`${w} × ${h}`, unit * 0.06, unit * 0.12);
}

function drawGraphic(ctx: OffscreenCanvasRenderingContext2D, spec: SampleSpec): void {
  const { width: w, height: h, hue } = spec;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const unit = Math.min(w, h);
  ctx.fillStyle = `hsl(${hue} 70% 45%)`;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.42, unit * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c1917';
  ctx.font = `700 ${Math.round(unit * 0.11)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('Snap', w / 2, h * 0.84);
}

async function makeSample(spec: SampleSpec): Promise<SampleFile> {
  if (spec.broken) {
    // A JPEG start marker followed by junk: looks like a JPEG, can't be decoded.
    const bytes = new Uint8Array(48 * 1024);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24;
    return { name: spec.name, type: 'image/jpeg', blob: new Blob([bytes], { type: 'image/jpeg' }) };
  }
  const canvas = new OffscreenCanvas(spec.width, spec.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  if (spec.graphic) drawGraphic(ctx, spec);
  else drawPhoto(ctx, spec);
  const blob = await canvas.convertToBlob({ type: spec.type, quality: 0.92 });
  // A browser that can't write the asked type (e.g. WebP in Safari) gives PNG: name it so.
  const name =
    blob.type === spec.type
      ? spec.name
      : spec.name.replace(/\.[^.]+$/, `.${blob.type.split('/')[1] ?? 'png'}`);
  return { name, type: blob.type, blob };
}

self.onmessage = async () => {
  let response: SampleResponse;
  try {
    const files: SampleFile[] = [];
    for (const spec of SAMPLE_SPECS) files.push(await makeSample(spec));
    response = { type: 'done', files };
  } catch (error) {
    response = { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
