// P24 security fuzz: the two parsers that read untrusted bytes on the main thread or before any
// decoder runs. 10,000 cases each, from real fixture headers (corrupted, truncated, spliced) and
// plain random bytes. Every case must finish quickly and never throw anything unexpected:
//  - intake header parser (`sniffKind` + `headerSizeFromBytes`): never throws, sizes are sane
//  - JPEG segment parser (`parseJpeg` → `readFrame` → `chromaSubsampling`, EXIF orientation):
//    parses or throws JpegFormatError, nothing else
import { describe, expect, it } from 'vitest';
import { corrupt, random } from '@/engines/image/decode/testing/fuzz';
import {
  chromaSubsampling,
  JpegFormatError,
  parseJpeg,
  readFrame,
} from '@/engines/image/metadata/jpeg-segments';
import { sniffKind } from '@/features/intake/detect';
import { headerSizeFromBytes, readExifOrientation } from '@/features/intake/header';
import { fixtureBytes } from '@/features/intake/test-fixtures';
import { timingLimit } from '../support/timing';

const CASES = 10_000;
/** One case may not take longer than this (a hang shows up as a timeout long before). */
const CASE_MS = timingLimit(50, 500);

const head = (path: string, max = 64 * 1024) => fixtureBytes(path).subarray(0, max);

const imageSeeds: Uint8Array[] = [
  head('images/gps.jpg'),
  head('images/orientation-6.jpg'),
  head('images/no-exif.jpg'),
  head('quality/photo-portrait-exif-rotated.jpg'),
  head('images/alpha.png'),
  head('quality/text-screenshot.png', 4096),
  head('images/sample.webp'),
  head('intake/webp-alpha.webp'),
  head('intake/webp-lossless.webp'),
  head('images/sample.avif'),
  head('images/iphone-7.heic', 16 * 1024),
  head('images/sample.gif'),
  head('images/sample.bmp'),
  head('intake/sample.pdf', 4096),
  head('intake/sample.cr3', 4096),
  head('intake/sample.dng', 4096),
];

const jpegSeeds: Uint8Array[] = [
  head('images/gps.jpg'),
  head('images/orientation-8.jpg'),
  head('images/no-exif.jpg'),
  head('quality/photo-portrait-exif-rotated.jpg'),
  head('quality/photo-product-on-white.jpg'),
];

/** Random bytes, optionally behind a real magic number so the parser gets past the first check. */
function randomBytes(rnd: () => number, prefix: number[] = []): Uint8Array {
  const out = new Uint8Array(prefix.length + Math.floor(rnd() * 2048));
  out.set(prefix);
  for (let i = prefix.length; i < out.length; i++) out[i] = Math.floor(rnd() * 256);
  return out;
}

const MAGICS: number[][] = [
  [0xff, 0xd8, 0xff, 0xe1],
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58],
  [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
  [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66],
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  [0x42, 0x4d],
  [0x49, 0x49, 0x2a, 0x00],
  [],
];

/** Mostly corrupted real headers (1–3 corruptions stacked), sometimes random bytes. */
function nextCase(seeds: Uint8Array[], magics: number[][], rnd: () => number): Uint8Array {
  if (rnd() < 0.2) return randomBytes(rnd, magics[Math.floor(rnd() * magics.length)]);
  let bytes = seeds[Math.floor(rnd() * seeds.length)] ?? new Uint8Array();
  const rounds = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < rounds && bytes.length > 0; i++) bytes = corrupt(bytes, rnd);
  return bytes;
}

describe('fuzz (P24)', () => {
  it(`intake header parser: ${CASES} cases, never throws or hangs`, async () => {
    const rnd = random(24_001);
    let slowest = 0;
    let sized = 0;
    for (let n = 0; n < CASES; n++) {
      const bytes = nextCase(imageSeeds, MAGICS, rnd);
      const t0 = performance.now();
      const kind = sniffKind(bytes, n % 2 ? 'x.dng' : 'x.jpg');
      const size = await headerSizeFromBytes(bytes);
      const ms = performance.now() - t0;
      slowest = Math.max(slowest, ms);
      expect(['image', 'heic', 'pdf', 'raw', 'unknown'], `case ${n}`).toContain(kind);
      if (size) {
        sized++;
        expect(Number.isInteger(size.width) && size.width > 0, `case ${n}`).toBe(true);
        expect(Number.isInteger(size.height) && size.height > 0, `case ${n}`).toBe(true);
      }
      expect(ms, `case ${n} took ${ms.toFixed(1)} ms`).toBeLessThan(CASE_MS);
    }
    // Many corrupted headers still carry a readable size: the parser isn't just giving up.
    expect(sized).toBeGreaterThan(CASES / 10);
    expect(slowest).toBeLessThan(CASE_MS);
  }, 120_000);

  it(`JPEG segment parser: ${CASES} cases, parses or throws JpegFormatError`, () => {
    const rnd = random(24_002);
    let threw = 0;
    let slowest = 0;
    for (let n = 0; n < CASES; n++) {
      const bytes = nextCase(jpegSeeds, [[0xff, 0xd8], [0xff, 0xd8, 0xff, 0xe1], []], rnd);
      const t0 = performance.now();
      try {
        const parsed = parseJpeg(bytes);
        for (const s of parsed.segments) {
          if (s.marker === 0xe1) readExifOrientation(s.data.subarray(6));
        }
        const frame = readFrame(parsed);
        expect(['4:4:4', '4:2:0', '4:2:2', 'gray', 'other']).toContain(chromaSubsampling(frame));
      } catch (e) {
        threw++;
        expect(e, `case ${n}`).toBeInstanceOf(JpegFormatError);
      }
      const ms = performance.now() - t0;
      slowest = Math.max(slowest, ms);
      expect(ms, `case ${n} took ${ms.toFixed(1)} ms`).toBeLessThan(CASE_MS);
    }
    expect(threw).toBeGreaterThan(CASES / 10);
    expect(threw).toBeLessThan(CASES);
    expect(slowest).toBeLessThan(CASE_MS);
  });
});
