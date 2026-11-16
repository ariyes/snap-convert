/**
 * Generated test pictures for the encoder and quality tests (P06). They stand in for the
 * reference photos in tests/fixtures/quality/ (P05) and are deterministic for a given seed.
 * Test-only: nothing in the app imports this file.
 */
import type { Pixels } from '../pixels';

export interface TestImage extends Pixels {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blank(width: number, height: number): TestImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Adds one octave of smooth value noise (range ±amp) with the given feature size. */
function addNoiseOctave(
  out: Float32Array,
  width: number,
  height: number,
  period: number,
  amp: number,
  rand: () => number,
): void {
  const gw = Math.ceil(width / period) + 2;
  const gh = Math.ceil(height / period) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = (rand() * 2 - 1) * amp;
  const inv = 1 / period;
  for (let y = 0; y < height; y++) {
    const gy = y * inv;
    const y0 = gy | 0;
    const ty = gy - y0;
    const fy = ty * ty * (3 - 2 * ty);
    const r0 = y0 * gw;
    const r1 = r0 + gw;
    let o = y * width;
    for (let x = 0; x < width; x++, o++) {
      const gx = x * inv;
      const x0 = gx | 0;
      const tx = gx - x0;
      const fx = tx * tx * (3 - 2 * tx);
      const a = grid[r0 + x0]!;
      const b = grid[r0 + x0 + 1]!;
      const c = grid[r1 + x0]!;
      const d = grid[r1 + x0 + 1]!;
      const top = a + (b - a) * fx;
      const bottom = c + (d - c) * fx;
      out[o]! += top + (bottom - top) * fy;
    }
  }
}

export interface PhotoOptions {
  seed?: number;
  /** Standard deviation of per-pixel sensor grain, in 8-bit levels. */
  grain?: number;
  /** Mean brightness 0–255. */
  brightness?: number;
  /** How strong fine detail is compared with a natural (1/f) photo; 1 = natural. */
  detail?: number;
}

/**
 * Photo-like picture: 1/f ("natural image") luminance noise from 2 px detail up to the whole
 * frame, soft colour regions, a scatter of hard-edged objects, and optional sensor grain.
 */
export function photoLike(width: number, height: number, o: PhotoOptions = {}): TestImage {
  const rand = mulberry32(o.seed ?? 1);
  const grain = o.grain ?? 1.5;
  const brightness = o.brightness ?? 120;
  const detail = o.detail ?? 1;
  const n = width * height;
  const lum = new Float32Array(n);
  const cb = new Float32Array(n);
  const cr = new Float32Array(n);

  const largest = Math.max(width, height);
  for (let period = largest / 2; period >= 2; period /= 2) {
    // Natural images: amplitude roughly proportional to feature size (1/f spectrum).
    const amp = 70 * Math.pow(period / largest, 0.9) * (period < 16 ? detail : 1);
    addNoiseOctave(lum, width, height, period, Math.max(amp, 2.5 * detail), rand);
    if (period >= 48) {
      addNoiseOctave(cb, width, height, period, 22 * (period / largest) + 4, rand);
      addNoiseOctave(cr, width, height, period, 22 * (period / largest) + 4, rand);
    }
  }

  // Hard-edged objects (anti-aliased), each with its own tone and colour cast.
  const objects = 60;
  for (let k = 0; k < objects; k++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const r = (0.02 + rand() * 0.08) * largest;
    const dl = (rand() * 2 - 1) * 60;
    const dcb = (rand() * 2 - 1) * 30;
    const dcr = (rand() * 2 - 1) * 30;
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(width - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(height - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) - r;
        const cover = d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d;
        if (cover === 0) continue;
        const i = y * width + x;
        lum[i]! += dl * cover;
        cb[i]! += dcb * cover;
        cr[i]! += dcr * cover;
      }
    }
  }

  const img = blank(width, height);
  const d = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const l = brightness + lum[i]!;
    const g1 = grain === 0 ? 0 : (rand() + rand() + rand() - 1.5) * 2 * grain;
    const g2 = grain === 0 ? 0 : (rand() + rand() + rand() - 1.5) * 2 * grain;
    const b = cb[i]!;
    const r = cr[i]!;
    d[p] = l + 1.402 * r + g1;
    d[p + 1] = l - 0.344 * b - 0.714 * r + g2;
    d[p + 2] = l + 1.772 * b + (g1 + g2) / 2;
    d[p + 3] = 255;
  }
  return img;
}

/**
 * A landscape-like scene, closer to a real camera photo than `photoLike`: a smooth sky with soft
 * clouds over textured ground whose fine detail comes and goes (foliage patches next to smooth
 * areas), shaded buildings with windows, thin dark lines (branches, wires) and light grain.
 */
export function photoScene(width: number, height: number, o: PhotoOptions = {}): TestImage {
  const rand = mulberry32(o.seed ?? 11);
  const grain = o.grain ?? 1;
  const detail = o.detail ?? 1;
  const exposure = (o.brightness ?? 120) / 120;
  const n = width * height;
  const largest = Math.max(width, height);
  const coarse = new Float32Array(n);
  const fine = new Float32Array(n);
  const mask = new Float32Array(n);
  const cb = new Float32Array(n);
  const cr = new Float32Array(n);
  for (let period = largest / 2; period >= 2; period /= 2) {
    const amp = 60 * Math.pow(period / largest, 0.8);
    if (period >= 64) addNoiseOctave(coarse, width, height, period, amp, rand);
    else addNoiseOctave(fine, width, height, period, Math.max(amp, 3) * 1.6 * detail, rand);
    if (period >= 64) {
      addNoiseOctave(cb, width, height, period, 18 * (period / largest) + 3, rand);
      addNoiseOctave(cr, width, height, period, 18 * (period / largest) + 3, rand);
    }
  }
  addNoiseOctave(mask, width, height, largest / 6, 1.6, rand);
  addNoiseOctave(mask, width, height, largest / 24, 0.6, rand);

  // Horizon: a wavy line about 40% down.
  const horizon = new Float32Array(width);
  const phase = rand() * 6;
  for (let x = 0; x < width; x++) {
    const t = x / width;
    horizon[x] = height * (0.4 + 0.06 * Math.sin(t * 7 + phase) + 0.025 * Math.sin(t * 23 + phase * 2));
  }

  const lum = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const sky = Math.min(1, Math.max(0, horizon[x]! - y + 0.5));
      // Sky: gradient plus soft clouds; ground: darker with patchy texture.
      const skyLum = 150 + 60 * (y / height) + 0.5 * coarse[i]!;
      const m = Math.min(1, Math.max(0, 0.5 + mask[i]!));
      const groundLum = 95 + coarse[i]! + fine[i]! * (0.08 + 0.92 * m * m);
      lum[i] = skyLum * sky + groundLum * (1 - sky);
      // Sky is blue, ground green-brown.
      cb[i] = cb[i]! + 28 * sky - 14 * (1 - sky);
      cr[i] = cr[i]! - 12 * sky + 4 * (1 - sky);
    }
  }

  // Buildings: shaded boxes with a lit side, sitting on the ground, with rows of windows.
  const fill = (x0: number, y0: number, x1: number, y1: number, f: (x: number, y: number) => number) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
        // Anti-aliased coverage of the box edges.
        const cover =
          Math.min(1, Math.max(0, x + 1 - x0)) * Math.min(1, Math.max(0, x1 - x)) *
          Math.min(1, Math.max(0, y + 1 - y0)) * Math.min(1, Math.max(0, y1 - y));
        const i = y * width + x;
        lum[i] = lum[i]! + (f(x, y) - lum[i]!) * cover;
      }
    }
  };
  for (let k = 0; k < 14; k++) {
    const w = (0.04 + rand() * 0.08) * width;
    const x0 = rand() * (width - w);
    const base = horizon[Math.min(width - 1, Math.floor(x0 + w / 2))]! + 0.15 * height * rand();
    const h = (0.08 + rand() * 0.2) * height;
    const tone = 90 + rand() * 100;
    fill(x0, base - h, x0 + w, base, (x) => tone - 30 * ((x - x0) / w));
    const win = Math.max(3, w / 10);
    for (let wy = base - h + win; wy + win < base - win; wy += win * 2) {
      for (let wx = x0 + win; wx + win < x0 + w - win / 2; wx += win * 2) {
        const lit = rand() < 0.3 ? 225 : 45;
        fill(wx, wy, wx + win, wy + win * 1.2, () => lit);
      }
    }
  }

  // Thin dark lines: branches and wires, 1–2 px wide, anti-aliased.
  for (let k = 0; k < 120; k++) {
    let x = rand() * width;
    let y = rand() * height;
    let angle = rand() * Math.PI * 2;
    const half = 0.4 + rand() * 0.6;
    const steps = 50 + rand() * 300;
    for (let s = 0; s < steps; s++) {
      angle += (rand() - 0.5) * 0.3;
      x += Math.cos(angle);
      y += Math.sin(angle);
      for (let yy = Math.floor(y - 2); yy <= Math.ceil(y + 2); yy++) {
        for (let xx = Math.floor(x - 2); xx <= Math.ceil(x + 2); xx++) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const dist = Math.hypot(xx + 0.5 - x, yy + 0.5 - y) - half;
          const cover = dist <= -0.5 ? 1 : dist >= 0.5 ? 0 : 0.5 - dist;
          const i = yy * width + xx;
          lum[i] = Math.min(lum[i]!, lum[i]! + (35 - lum[i]!) * cover);
        }
      }
    }
  }

  const img = blank(width, height);
  const d = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const l = lum[i]! * exposure;
    const g = grain === 0 ? 0 : (rand() + rand() + rand() - 1.5) * 2 * grain;
    const b = cb[i]! * exposure;
    const r = cr[i]! * exposure;
    d[p] = l + 1.402 * r + g;
    d[p + 1] = l - 0.344 * b - 0.714 * r + g;
    d[p + 2] = l + 1.772 * b + g;
    d[p + 3] = 255;
  }
  return img;
}

/**
 * Product shot on a pure white background: a shaded, lightly textured bottle with a label and a
 * soft shadow. Mostly flat white, yet a photo (should not be flagged as a graphic).
 */
export function productOnWhite(width: number, height: number, seed = 5): TestImage {
  const rand = mulberry32(seed);
  const n = width * height;
  const texture = new Float32Array(n);
  for (let period = 64; period >= 2; period /= 2) addNoiseOctave(texture, width, height, period, 2 + period / 16, rand);
  const img = blank(width, height);
  const d = img.data;
  const cx = width / 2;
  const top = height * 0.15;
  const bottom = height * 0.85;
  const half = width * 0.14;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      // Soft elliptical shadow under the bottle.
      const sx = (x - cx - half * 0.4) / (half * 1.8);
      const sy = (y - bottom) / (height * 0.04);
      const shadow = Math.max(0, 1 - Math.hypot(sx, sy));
      let r = 255 - 70 * shadow * shadow;
      let g = r;
      let b = r;
      // Bottle body: rounded rectangle, shaded left-to-right like a cylinder.
      const dx = Math.abs(x + 0.5 - cx) - half;
      const dy = Math.max(top - y - 0.5, y + 0.5 - bottom);
      const dist = Math.max(dx, dy);
      const cover = dist <= -0.5 ? 1 : dist >= 0.5 ? 0 : 0.5 - dist;
      if (cover > 0) {
        const u = (x - cx) / half; // -1 … 1 across the bottle
        const shade = 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - u * u)) + 0.25 * Math.max(0, 1 - Math.abs(u + 0.45) * 6);
        const onLabel = y > height * 0.45 && y < height * 0.65;
        const base = onLabel ? [235, 225, 200] : [40, 110, 70];
        const stripe = onLabel && Math.floor((y - height * 0.45) / 6) % 3 === 0 && Math.abs(u) < 0.6 ? 0.45 : 1;
        const t = texture[i]!;
        const br = Math.min(255, base[0]! * shade * stripe + t);
        const bg = Math.min(255, base[1]! * shade * stripe + t);
        const bb = Math.min(255, base[2]! * shade * stripe + t);
        r += (br - r) * cover;
        g += (bg - g) * cover;
        b += (bb - b) * cover;
      }
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = b;
      d[p + 3] = 255;
    }
  }
  return img;
}

/** Smooth sky: light-to-deep blue from bottom to top with a gentle sideways drift. Steps ≤ 1 level. */
export function skyGradient(width: number, height: number): TestImage {
  const img = blank(width, height);
  const d = img.data;
  const top = [52, 104, 178];
  const bottom = [196, 222, 246];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = Math.min(1, Math.max(0, y / (height - 1) + 0.04 * Math.sin((x / width) * Math.PI)));
      const p = (y * width + x) * 4;
      d[p] = Math.round(top[0]! + (bottom[0]! - top[0]!) * t);
      d[p + 1] = Math.round(top[1]! + (bottom[1]! - top[1]!) * t);
      d[p + 2] = Math.round(top[2]! + (bottom[2]! - top[2]!) * t);
      d[p + 3] = 255;
    }
  }
  return img;
}

type Shape = (x: number, y: number) => number; // signed distance in px, < 0 inside

/** Flat-colour logo / line art on white, anti-aliased like a real export. */
export function logoArt(width: number, height: number, transparent = false): TestImage {
  const img = blank(width, height);
  const d = img.data;
  const s = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const layers: Array<{ shape: Shape; rgb: [number, number, number] }> = [
    { shape: (x, y) => Math.hypot(x - cx, y - cy) - s * 0.4, rgb: [226, 38, 54] },
    { shape: (x, y) => Math.hypot(x - cx, y - cy) - s * 0.3, rgb: [255, 255, 255] },
    {
      shape: (x, y) => Math.max(Math.abs(x - cx) - s * 0.22, Math.abs(y - cy) - s * 0.06),
      rgb: [20, 70, 160],
    },
    {
      shape: (x, y) => Math.max(Math.abs(x - cx) - s * 0.06, Math.abs(y - cy) - s * 0.22),
      rgb: [20, 70, 160],
    },
    // A thin ring: line art detail
    { shape: (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - s * 0.45) - 1.5, rgb: [30, 30, 30] },
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 255;
      let g = 255;
      let b = 255;
      let a = transparent ? 0 : 255;
      for (const layer of layers) {
        const dist = layer.shape(x + 0.5, y + 0.5);
        const cover = dist <= -0.5 ? 1 : dist >= 0.5 ? 0 : 0.5 - dist;
        if (cover === 0) continue;
        const [lr, lg, lb] = layer.rgb;
        if (transparent && a === 0) {
          r = lr;
          g = lg;
          b = lb;
          a = Math.round(cover * 255);
        } else {
          r += (lr - r) * cover;
          g += (lg - g) * cover;
          b += (lb - b) * cover;
          a = transparent ? Math.round(a + (255 - a) * cover) : 255;
        }
      }
      const p = (y * width + x) * 4;
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = b;
      d[p + 3] = a;
    }
  }
  return img;
}

/**
 * A text-heavy screenshot (title bar, sidebar, body text, coloured links and a red warning),
 * drawn with real browser text rendering. Needs OffscreenCanvas (browser or worker).
 */
export function textScreenshot(width: number, height: number, seed = 7): TestImage {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  const rand = mulberry32(seed);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#2b2d42';
  ctx.fillRect(0, 0, width, 36);
  ctx.fillStyle = '#f1f3f5';
  ctx.fillRect(0, 36, 180, height - 36);
  ctx.font = '600 15px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Snap Convert — Settings', 14, 24);
  ctx.font = '13px sans-serif';
  const words = ['image', 'quality', 'resize', 'convert', 'export', 'pixel', 'sharp', 'colour'];
  const sentence = (n: number) =>
    Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]!).join(' ');
  for (let y = 64; y < height - 10; y += 26) {
    ctx.fillStyle = '#343a40';
    ctx.fillText(sentence(2), 16, y);
  }
  const colours = ['#212529', '#212529', '#212529', '#1c63d6', '#c92a2a', '#2b8a3e'];
  for (let y = 64; y < height - 10; y += 19) {
    ctx.fillStyle = colours[Math.floor(rand() * colours.length)]!;
    ctx.fillText(sentence(12), 200, y);
  }
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

/** Largest jump between neighbouring pixels (any channel, across and down). */
export function maxNeighbourStep(img: Pixels): number {
  const { width, height, data } = img;
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        if (x + 1 < width) max = Math.max(max, Math.abs(data[p + c]! - data[p + 4 + c]!));
        if (y + 1 < height) max = Math.max(max, Math.abs(data[p + c]! - data[p + width * 4 + c]!));
      }
    }
  }
  return max;
}
