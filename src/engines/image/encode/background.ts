import type { Pixels } from '../quality/pixels';

export type Rgb = readonly [r: number, g: number, b: number];

const WHITE: Rgb = [255, 255, 255];

const NAMED: Record<string, Rgb> = {
  white: WHITE,
  black: [0, 0, 0],
  transparent: WHITE, // JPEG has no transparency; "transparent" means the default
};

/**
 * Parses the CSS colour used behind transparent pixels when saving as JPEG.
 * Handles #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and white/black/transparent here
 * (no DOM needed, so it works in a worker), then falls back to OffscreenCanvas for any other
 * CSS colour. Anything unreadable gives white. A translucent colour is mixed with white.
 */
export function parseBackground(css: string | undefined): Rgb {
  if (!css) return WHITE;
  const s = css.trim().toLowerCase();
  const named = NAMED[s];
  if (named) return named;

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const v = (k: number) => parseInt(full.slice(k * 2, k * 2 + 2), 16);
    return overWhite([v(0), v(1), v(2)], full.length === 8 ? v(3) / 255 : 1);
  }

  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 3 || parts.length === 4) {
      const rgb = parts.slice(0, 3).map((p) => channel(p, 255));
      const alpha = parts[3] === undefined ? 1 : channel(parts[3], 1);
      if (rgb.every((c) => Number.isFinite(c)) && Number.isFinite(alpha)) {
        return overWhite([rgb[0]!, rgb[1]!, rgb[2]!], alpha);
      }
    }
  }

  return viaCanvas(s) ?? WHITE;
}

function channel(token: string, scale: number): number {
  const pct = token.endsWith('%');
  const n = Number(pct ? token.slice(0, -1) : token);
  if (!Number.isFinite(n)) return NaN;
  const v = pct ? (n / 100) * scale : n;
  return Math.min(scale, Math.max(0, v));
}

function overWhite([r, g, b]: Rgb, alpha: number): Rgb {
  const a = Math.min(1, Math.max(0, alpha));
  const mix = (c: number) => Math.round(c * a + 255 * (1 - a));
  return [mix(r), mix(g), mix(b)];
}

function viaCanvas(css: string): Rgb | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillStyle = css; // ignored if invalid
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return overWhite([r!, g!, b!], a! / 255);
  } catch {
    return null;
  }
}

/** True if any pixel is not fully opaque. */
export function hasTransparency(img: Pixels): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) return true;
  }
  return false;
}

/**
 * Composites the image over a solid colour so it can be saved without alpha.
 * Returns the input unchanged when it is already fully opaque.
 */
export function flattenOnto(img: Pixels, [br, bg, bb]: Rgb): Pixels {
  if (!hasTransparency(img)) return img;
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3]!;
    if (a === 255) {
      out[i] = src[i]!;
      out[i + 1] = src[i + 1]!;
      out[i + 2] = src[i + 2]!;
    } else {
      const k = a / 255;
      out[i] = src[i]! * k + br * (1 - k);
      out[i + 1] = src[i + 1]! * k + bg * (1 - k);
      out[i + 2] = src[i + 2]! * k + bb * (1 - k);
    }
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}
