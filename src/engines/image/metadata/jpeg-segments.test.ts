import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../quality/testing/synthetic';
import {
  chromaSubsampling,
  JpegFormatError,
  MARKER,
  parseJpeg,
  readFrame,
  writeJpeg,
} from './jpeg-segments';
import { buildExifTiff, buildJpeg, commentSegment, exifSegment, xmpSegment } from './testing/builders';

describe('parseJpeg', () => {
  it('reads header segments in order and keeps the scan data untouched', () => {
    const bytes = buildJpeg([exifSegment(buildExifTiff()), xmpSegment(), commentSegment('hi')]);
    const parsed = parseJpeg(bytes);
    expect(parsed.segments.map((s) => s.marker)).toEqual([
      MARKER.APP0,
      MARKER.APP1,
      MARKER.APP1,
      MARKER.COM,
      0xdb,
      0xc0,
      0xc4,
    ]);
    expect(parsed.scan[0]).toBe(0xff);
    expect(parsed.scan[1]).toBe(MARKER.SOS);
    expect(Array.from(parsed.scan.subarray(-2))).toEqual([0xff, MARKER.EOI]);
  });

  it('round-trips through writeJpeg byte for byte', () => {
    const bytes = buildJpeg([exifSegment(buildExifTiff({ gps: true }))]);
    const parsed = parseJpeg(bytes);
    expect(writeJpeg(parsed.segments, parsed.scan)).toEqual(bytes);
  });

  it('reads the frame size and chroma sampling', () => {
    const frame = readFrame(parseJpeg(buildJpeg()));
    expect(frame).toMatchObject({ width: 16, height: 16, progressive: false });
    expect(chromaSubsampling(frame)).toBe('4:2:0');
  });

  it('skips 0xFF fill bytes before a marker', () => {
    const bytes = buildJpeg();
    const padded = new Uint8Array(bytes.length + 3);
    padded.set(bytes.subarray(0, 2));
    padded.set([0xff, 0xff, 0xff], 2);
    padded.set(bytes.subarray(2), 5);
    expect(parseJpeg(padded).segments).toHaveLength(parseJpeg(bytes).segments.length);
  });

  const malformed: Array<[string, (b: Uint8Array) => Uint8Array]> = [
    ['empty file', () => new Uint8Array(0)],
    ['not a JPEG', (b) => b.map((x, i) => (i === 0 ? 0x89 : x))],
    ['cut off inside the headers', (b) => b.subarray(0, 30)],
    ['cut off right after SOI', (b) => b.subarray(0, 2)],
    ['segment length past the end', (b) => b.map((x, i) => (i === 4 ? 0xff : i === 5 ? 0xf0 : x))],
    ['segment length below 2', (b) => b.map((x, i) => (i === 4 ? 0 : i === 5 ? 1 : x))],
    ['garbage where a marker should be', (b) => b.map((x, i) => (i === 2 ? 0x12 : x))],
    ['a second SOI', (b) => b.map((x, i) => (i === 3 ? MARKER.SOI : x))],
    ['EOI before the image data', (b) => b.map((x, i) => (i === 3 ? MARKER.EOI : x))],
    ['all fill bytes', (b) => new Uint8Array(b.length).fill(0xff).map((x, i) => (i === 1 ? MARKER.SOI : x))],
  ];
  it.each(malformed)('throws a readable JpegFormatError: %s', (_, corrupt) => {
    const bad = corrupt(buildJpeg());
    expect(() => parseJpeg(bad)).toThrow(JpegFormatError);
    try {
      parseJpeg(bad);
    } catch (e) {
      expect((e as Error).message).toMatch(/JPEG/);
      expect((e as Error).message.length).toBeLessThan(120);
    }
  });

  it('rejects a file whose frame header is missing', () => {
    const parsed = parseJpeg(buildJpeg());
    const noFrame = writeJpeg(
      parsed.segments.filter((s) => s.marker !== 0xc0),
      parsed.scan,
    );
    expect(() => parseJpeg(noFrame)).toThrow(/no image size/);
  });

  it('fuzz: 500 random corruptions each finish within 100 ms, parsing or throwing JpegFormatError', () => {
    const original = buildJpeg([exifSegment(buildExifTiff({ gps: true, thumbnail: true })), xmpSegment()]);
    const headerEnd = original.length - parseJpeg(original).scan.length;
    const rand = mulberry32(2026);
    let threw = 0;
    let slowest = 0;
    for (let round = 0; round < 500; round++) {
      const bytes = original.slice();
      const mode = round % 4;
      // Mostly hit the header area, where the parser actually reads.
      const pick = () => Math.floor(rand() * (rand() < 0.85 ? headerEnd : bytes.length));
      let input: Uint8Array = bytes;
      if (mode === 0) {
        for (let k = 0; k < 1 + rand() * 8; k++) bytes[pick()] = Math.floor(rand() * 256);
      } else if (mode === 1) {
        const at = pick();
        bytes[at] = 0xff;
        if (at + 1 < bytes.length) bytes[at + 1] = Math.floor(rand() * 256);
      } else if (mode === 2) {
        input = bytes.subarray(0, pick());
      } else {
        const at = pick();
        bytes.fill(rand() < 0.5 ? 0xff : 0x00, at, at + Math.floor(rand() * 40));
      }
      const t0 = performance.now();
      try {
        const parsed = parseJpeg(input);
        readFrame(parsed);
      } catch (e) {
        threw++;
        expect(e).toBeInstanceOf(JpegFormatError);
        expect((e as Error).message).toMatch(/JPEG/);
      }
      const ms = performance.now() - t0;
      slowest = Math.max(slowest, ms);
      expect(ms).toBeLessThan(100);
    }
    // Most corruptions in the header area must be caught, not silently accepted.
    expect(threw).toBeGreaterThan(150);
    expect(slowest).toBeLessThan(100);
  });
});
