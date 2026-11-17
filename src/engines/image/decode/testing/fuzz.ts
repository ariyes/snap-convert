// Test-only helpers for fuzzing the pure decoders with random corruptions.

/** Small deterministic PRNG (mulberry32), so a failing case can be replayed. */
export function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One random corruption of `bytes`: flipped bytes, a truncation, inserted or deleted bytes, or a
 * byte forced to 0x00 / 0xff (common edge values in headers).
 */
export function corrupt(bytes: Uint8Array, rnd: () => number): Uint8Array {
  const at = (n: number) => Math.floor(rnd() * n);
  const kind = at(6);
  if (kind === 0) {
    const out = bytes.slice();
    const flips = 1 + at(8);
    for (let i = 0; i < flips; i++) out[at(out.length)] = at(256);
    return out;
  }
  if (kind === 1) return bytes.slice(0, at(bytes.length));
  if (kind === 2) {
    const pos = at(bytes.length);
    const extra = Uint8Array.from({ length: 1 + at(16) }, () => at(256));
    const out = new Uint8Array(bytes.length + extra.length);
    out.set(bytes.subarray(0, pos));
    out.set(extra, pos);
    out.set(bytes.subarray(pos), pos + extra.length);
    return out;
  }
  if (kind === 3) {
    const pos = at(bytes.length);
    const n = Math.min(1 + at(16), bytes.length - pos);
    const out = new Uint8Array(bytes.length - n);
    out.set(bytes.subarray(0, pos));
    out.set(bytes.subarray(pos + n), pos);
    return out;
  }
  const out = bytes.slice();
  // Mostly the header area, where sizes and flags live.
  const pos = rnd() < 0.7 ? at(Math.min(64, out.length)) : at(out.length);
  out[pos] = kind === 4 ? 0 : 0xff;
  return out;
}
