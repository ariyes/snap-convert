// Test helpers: the camera RAW fixtures from `pnpm fixtures:raw` (tests/fixtures/raw/cache/,
// git-ignored, served by the test server from the project folder; never fetched from the internet).

/** Message for tests skipped because the RAW files haven't been downloaded. */
export const MISSING_RAW_FIXTURES =
  'RAW test files missing: run `pnpm fixtures:raw` (downloads CC0 files from raw.pixls.us into tests/fixtures/raw/cache/)';

const BASE = '/tests/fixtures/raw/cache/';

/** A RAW fixture as a File (with its name, like a picked file), or undefined when not downloaded. */
export async function rawFixture(name: string): Promise<File | undefined> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${name}`);
  } catch {
    return undefined;
  }
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || type.startsWith('text/html')) return undefined;
  return new File([await response.blob()], name);
}

// ---------- colour comparison (CIE Lab, ΔE 2000) ----------

export type Lab = [number, number, number];

function linear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB 0–255 → CIE Lab (D65). */
export function srgbToLab(r: number, g: number, b: number): Lab {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** CIEDE2000 colour difference. */
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt(
    (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH),
  );
}

/** Mean Lab of each cell of a `cols` × `rows` grid laid over the picture (by relative position). */
export function labGrid(img: ImageData, cols: number, rows: number): Lab[] {
  const sums = new Float64Array(cols * rows * 4);
  const { width: w, height: h, data } = img;
  for (let y = 0; y < h; y += 2) {
    const gy = Math.min(rows - 1, Math.floor((y / h) * rows));
    for (let x = 0; x < w; x += 2) {
      const gx = Math.min(cols - 1, Math.floor((x / w) * cols));
      const i = (y * w + x) * 4;
      const k = (gy * cols + gx) * 4;
      sums[k] = sums[k]! + data[i]!;
      sums[k + 1] = sums[k + 1]! + data[i + 1]!;
      sums[k + 2] = sums[k + 2]! + data[i + 2]!;
      sums[k + 3] = sums[k + 3]! + 1;
    }
  }
  const grid: Lab[] = [];
  for (let k = 0; k < cols * rows; k++) {
    const n = sums[k * 4 + 3]!;
    grid.push(srgbToLab(sums[k * 4]! / n, sums[k * 4 + 1]! / n, sums[k * 4 + 2]! / n));
  }
  return grid;
}

/**
 * Indices of the most neutral, evenly lit grid cells of `reference` (mid-tones, low chroma, close
 * to their neighbours, so slightly different crops between decoders don't matter).
 */
export function neutralCells(
  reference: Lab[],
  cols: number,
  rows: number,
  count: number,
): number[] {
  const cells: Array<{ k: number; score: number }> = [];
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const k = y * cols + x;
      const lab = reference[k]!;
      if (lab[0] < 25 || lab[0] > 92) continue;
      let spread = 0;
      for (const d of [-1, 1, -cols, cols])
        spread = Math.max(spread, deltaE2000(lab, reference[k + d]!));
      cells.push({ k, score: Math.hypot(lab[1], lab[2]) + spread });
    }
  }
  return cells
    .sort((a, b) => a.score - b.score)
    .slice(0, count)
    .map((c) => c.k);
}

/** True when every named fixture is in the cache (checked without downloading them). */
export async function haveRawFixtures(...names: string[]): Promise<boolean> {
  const found = await Promise.all(
    names.map(async (name) => {
      try {
        const r = await fetch(`${BASE}${name}`, { method: 'HEAD' });
        return r.ok && !(r.headers.get('content-type') ?? '').startsWith('text/html');
      } catch {
        return false;
      }
    }),
  );
  return found.every(Boolean);
}
