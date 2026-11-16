// Test data only (never imported by app code).

/** Inserts an EXIF APP1 segment with the given orientation right after the JPEG SOI marker. */
export function withExifOrientation(
  jpeg: Uint8Array,
  orientation: number,
  littleEndian = false,
): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, 8, littleEndian); // IFD0 right after the header
  view.setUint16(8, 1, littleEndian); // one entry
  view.setUint16(10, 0x0112, littleEndian); // Orientation
  view.setUint16(12, 3, littleEndian); // SHORT
  view.setUint32(14, 1, littleEndian); // count
  view.setUint16(18, orientation, littleEndian);
  view.setUint32(22, 0, littleEndian); // no next IFD
  const payload = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
  const segment = new Uint8Array(4 + payload.length);
  segment.set([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]);
  segment.set(payload, 4);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2));
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}
