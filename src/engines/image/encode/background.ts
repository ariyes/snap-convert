import type { Pixels } from '../quality/pixels';

export type Rgb = readonly [r: number, g: number, b: number];

const WHITE: Rgb = [255, 255, 255];

/** The CSS named colours (CSS Color 4), as name → rrggbb. */
const CSS_NAMES =
  'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc ' +
  'bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a ' +
  'burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 ' +
  'cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b ' +
  'darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 ' +
  'darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 ' +
  'darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b ' +
  'darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 ' +
  'deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff ' +
  'firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ' +
  'ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f ' +
  'grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 ' +
  'khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd ' +
  'lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 ' +
  'lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a ' +
  'lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 ' +
  'lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 ' +
  'magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 ' +
  'mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a ' +
  'mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa ' +
  'mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 ' +
  'olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa ' +
  'palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 ' +
  'peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 ' +
  'rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 ' +
  'salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d ' +
  'silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa ' +
  'springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 ' +
  'turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 ' +
  'yellowgreen 9acd32';

let named: Map<string, Rgb> | undefined;

function namedColour(name: string): Rgb | undefined {
  if (name === 'transparent') return WHITE; // JPEG has no transparency; "transparent" means the default
  if (!named) {
    named = new Map();
    const parts = CSS_NAMES.split(' ');
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const hex = parseInt(parts[i + 1]!, 16);
      named.set(parts[i]!, [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff]);
    }
  }
  return named.get(name);
}

/**
 * Parses the CSS colour used behind transparent pixels when saving as JPEG.
 * Handles #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla() and the named colours here
 * (no canvas needed, so it works in any worker), then falls back to OffscreenCanvas, where there
 * is one, for any other CSS colour. Anything unreadable gives white. A translucent colour is
 * mixed with white.
 */
export function parseBackground(css: string | undefined): Rgb {
  if (!css) return WHITE;
  const s = css.trim().toLowerCase();
  const byName = namedColour(s);
  if (byName) return byName;

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

  const hsl = /^hsla?\(\s*([^)]*)\)$/.exec(s)?.[1];
  if (hsl) {
    const parts = hsl.split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 3 || parts.length === 4) {
      const h = hue(parts[0]!);
      const sat = percent(parts[1]!);
      const light = percent(parts[2]!);
      const alpha = parts[3] === undefined ? 1 : channel(parts[3], 1);
      if ([h, sat, light, alpha].every((v) => Number.isFinite(v))) {
        return overWhite(hslToRgb(h, sat, light), alpha);
      }
    }
  }

  return viaCanvas(s) ?? WHITE;
}

/** Hue in degrees from a CSS angle (bare number, deg, turn, rad or grad). */
function hue(token: string): number {
  const m = /^(-?[\d.]+(?:e-?\d+)?)(deg|turn|rad|grad)?$/.exec(token);
  if (!m) return NaN;
  const n = Number(m[1]);
  const factor = { deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 }[m[2] ?? 'deg'] ?? 1;
  return n * factor;
}

/** A CSS percentage (or bare number, as CSS Color 4 allows) as 0–1. */
function percent(token: string): number {
  const n = Number(token.endsWith('%') ? token.slice(0, -1) : token);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : NaN;
}

/** CSS Color 4 hsl → sRGB, channels 0–255 (unrounded; overWhite rounds). */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hh / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [f(0), f(8), f(4)];
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
